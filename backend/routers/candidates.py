import os
import re
import json
import uuid
import asyncio
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from openai import AsyncOpenAI
from dotenv import load_dotenv
from utils.pdf_reader import extract_text_from_pdf
from sqlalchemy.orm import Session
from database import get_db
from models import models
from schemas import schemas
from services.matching import calculate_and_save_match_score

load_dotenv()

router = APIRouter()

hf_api_key = os.getenv("HF_API_KEY")
client = AsyncOpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=hf_api_key
)

@router.post("/upload-cv")
async def upload_cv(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    try:
        contents = await file.read()
        
        # Check file size (max 50MB)
        if len(contents) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")
        
        import re
        sanitized_filename = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', file.filename)
        
        # Compress PDF if possible
        try:
            import fitz
            doc = fitz.open(stream=contents, filetype="pdf")
            contents_to_save = doc.tobytes(garbage=4, deflate=True)
            doc.close()
        except Exception as e:
            print("PDF Compression failed, using original:", e)
            contents_to_save = contents
        
        # Save file to .uploads/
        file_ext = os.path.splitext(sanitized_filename)[1]
        unique_filename = f"{uuid.uuid4().hex}{file_ext}"
        
        # Ensure .uploads directory exists
        os.makedirs(".uploads", exist_ok=True)
        local_path = os.path.join(".uploads", unique_filename)
        
        with open(local_path, "wb") as f:
            f.write(contents_to_save)
            
        resume_url = f"/.uploads/{unique_filename}"
        
        pdf_text = extract_text_from_pdf(contents)
        
        prompt = f"""You are an HR data extraction system. Extract structured data from the CV text below.
Return ONLY a valid JSON object with exactly these keys. No extra text, no markdown, no code blocks.

- "name": full name of the candidate (string)
- "email": email address (string, or empty string if not found)
- "skills": list of all technical and soft skills mentioned (array of strings)
- "total_experience_years": total years of professional work experience as an integer. Calculate carefully from all work history dates. Use 0 if less than 1 year or no experience.
- "education": list of educational qualifications (array of strings)
- "experience_details": list of all work experiences (array of strings, format: "Job Title at Company Name (Duration)")
- "projects": list of notable projects or achievements (array of strings, empty array if none)

CV Text:
{pdf_text}
"""
        
        # Retry mechanism for LLM API to prevent rate limiting
        max_retries = 3
        ai_response = ""
        for attempt in range(max_retries):
            try:
                response = await client.chat.completions.create(
                    model="Qwen/Qwen2.5-7B-Instruct:together",
                    messages=[
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.1,
                    max_tokens=1500,
                )
                ai_response = response.choices[0].message.content.strip()
                break
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"LLM extraction error, retrying in {2 ** attempt}s... ({e})")
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise Exception(f"AI API failed after {max_retries} attempts: {str(e)}")
        
        
        # Extract JSON from response — handles markdown fences and embedded JSON
        def extract_json(text: str) -> str:
            if text.startswith('```json'):
                text = text[7:]
                text = text[:text.rfind('```')].strip() if '```' in text else text.strip()
            elif text.startswith('```'):
                text = text[3:]
                text = text[:text.rfind('```')].strip() if '```' in text else text.strip()
            if not text.startswith('{'):
                match = re.search(r'\{[\s\S]*\}', text)
                if match:
                    text = match.group()
            return text.strip()

        raw_for_debug = ai_response
        ai_response = extract_json(ai_response)
        if not ai_response:
            print(f"[DEBUG] Empty after extraction. Raw (first 500): {raw_for_debug[:500]!r}")
            raise ValueError("Model returned no usable JSON content.")
        parsed_data = json.loads(ai_response)
        
        return {
            "status": "success",
            "extracted_data": parsed_data,
            "resume_url": resume_url
        }
    except json.JSONDecodeError as e:
        print(f"JSON parse error. Raw response was: {ai_response!r}")
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response as JSON: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        # Detect API rate limit / quota errors
        if any(keyword in error_msg.lower() for keyword in ["429", "rate limit", "quota", "too many requests", "timeout", "timed out"]):
            raise HTTPException(
                status_code=503,
                detail={
                    "error_type": "api_limit",
                    "message": "Gagal menganalisis CV. Limit API gratis dari developer mungkin sedang habis. Silakan coba beberapa saat lagi."
                }
            )
        raise HTTPException(status_code=500, detail=error_msg)

@router.post("/", response_model=schemas.CandidateResponse)
def create_candidate(candidate: schemas.CandidateCreate, db: Session = Depends(get_db)):
    import uuid as _uuid

    skills_str = candidate.skills
    if isinstance(candidate.skills, list):
        skills_str = json.dumps(candidate.skills)
        
    # Ensure job_id exists
    job = db.query(models.Job).filter(models.Job.id == candidate.job_id).first()
    if not job:
        raise HTTPException(status_code=400, detail=f"Job with id {candidate.job_id} does not exist.")

    # Check if email already exists
    existing_candidate = db.query(models.Candidate).filter(models.Candidate.email == candidate.email).first()
    if existing_candidate:
        # Only update if it's the SAME file being re-uploaded (same resume_url)
        if candidate.resume_url and existing_candidate.resume_url == candidate.resume_url:
            existing_candidate.name = candidate.name
            existing_candidate.skills = skills_str
            existing_candidate.education = candidate.education
            existing_candidate.experience_details = candidate.experience_details
            existing_candidate.projects = candidate.projects
            existing_candidate.experience_years = candidate.experience_years
            existing_candidate.job_id = candidate.job_id
            existing_candidate.resume_url = candidate.resume_url
            db.commit()
            db.refresh(existing_candidate)
            return existing_candidate
        else:
            # Different file → different candidate who happens to share an email (AI error).
            # Make the email unique so we can INSERT a new record.
            parts = candidate.email.rsplit("@", 1)
            unique_suffix = _uuid.uuid4().hex[:8]
            candidate.email = f"{parts[0]}_{unique_suffix}@{parts[1] if len(parts) > 1 else 'example.com'}"

    db_candidate = models.Candidate(
        name=candidate.name,
        email=candidate.email,
        skills=skills_str,
        education=candidate.education,
        experience_details=candidate.experience_details,
        projects=candidate.projects,
        experience_years=candidate.experience_years,
        resume_url=candidate.resume_url,
        job_id=candidate.job_id
    )
    db.add(db_candidate)
    try:
        db.commit()
        db.refresh(db_candidate)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return db_candidate

@router.get("/cv/{filename}/base64")
async def get_cv_base64(filename: str):
    import base64
    import os
    actual_filename = filename if filename.endswith(".pdf") else f"{filename}.pdf"
    file_path = os.path.join(".uploads", actual_filename)
    if not os.path.exists(file_path):
        file_path = os.path.join("uploads", actual_filename)
        
    abs_path = os.path.abspath(file_path)
    if os.path.exists(file_path):
        try:
            with open(file_path, "rb") as pdf_file:
                encoded = base64.b64encode(pdf_file.read()).decode("utf-8")
            return {"data": encoded}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")
    raise HTTPException(status_code=404, detail=f"File not found: {abs_path}")

@router.post("/{candidate_id}/calculate-match")
async def calculate_match(candidate_id: int, db: Session = Depends(get_db)):
    score = await calculate_and_save_match_score(db, candidate_id)
    if score is None:
        raise HTTPException(status_code=404, detail="Candidate or Job not found")
    return {"candidate_id": candidate_id, "match_score": score}

@router.get("/", response_model=list[schemas.CandidateResponse])
def get_candidates(db: Session = Depends(get_db)):
    return db.query(models.Candidate).order_by(models.Candidate.match_score.desc()).all()

@router.delete("/{candidate_id}")
def delete_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(models.Candidate).filter(models.Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    if candidate.resume_url:
        filename = candidate.resume_url.split("/")[-1]
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        file_path = os.path.join(base_dir, ".uploads", filename)
        
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Failed to delete file {file_path}: {e}")

    db.delete(candidate)
    db.commit()
    return {"status": "success", "message": "Candidate deleted successfully"}

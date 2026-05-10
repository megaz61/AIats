import os
import json
import uuid
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
        
        # Save file to uploads/
        file_ext = os.path.splitext(sanitized_filename)[1]
        unique_filename = f"{uuid.uuid4().hex}{file_ext}"
        local_path = os.path.join("uploads", unique_filename)
        
        with open(local_path, "wb") as f:
            f.write(contents)
            
        resume_url = f"/uploads/{unique_filename}"
        
        pdf_text = extract_text_from_pdf(contents)
        
        prompt = f"""Kamu adalah sistem HR. Ekstrak data lengkap CV berikut. Kembalikan HANYA dalam format JSON murni dengan keys:
- 'name' (string)
- 'email' (string)
- 'skills' (array of strings)
- 'total_experience_years' (integer)
- 'education' (array of strings)
- 'experience_details' (array of strings)
- 'projects' (array of strings)

Jangan ada teks tambahan di luar JSON.
        
Teks CV:
{pdf_text}
"""
        
        response = await client.chat.completions.create(
            model="meta-llama/Llama-3.1-8B-Instruct:novita",
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=1024,
        )
        
        ai_response = response.choices[0].message.content.strip()
        
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:-3].strip()
        elif ai_response.startswith("```"):
            ai_response = ai_response[3:-3].strip()
            
        parsed_data = json.loads(ai_response)
        
        return {
            "status": "success",
            "extracted_data": parsed_data,
            "resume_url": resume_url
        }
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse AI response as JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=schemas.CandidateResponse)
def create_candidate(candidate: schemas.CandidateCreate, db: Session = Depends(get_db)):
    skills_str = candidate.skills
    if isinstance(candidate.skills, list):
        skills_str = json.dumps(candidate.skills)
        
    # Ensure job_id exists
    job = db.query(models.Job).filter(models.Job.id == candidate.job_id).first()
    if not job:
        raise HTTPException(status_code=400, detail=f"Job with id {candidate.job_id} does not exist.")

    # Check if email already exists to prevent Unique constraint error
    existing_candidate = db.query(models.Candidate).filter(models.Candidate.email == candidate.email).first()
    if existing_candidate:
        existing_candidate.name = candidate.name
        existing_candidate.skills = skills_str
        existing_candidate.education = candidate.education
        existing_candidate.experience_details = candidate.experience_details
        existing_candidate.projects = candidate.projects
        existing_candidate.experience_years = candidate.experience_years
        existing_candidate.job_id = candidate.job_id
        db.commit()
        db.refresh(existing_candidate)
        return existing_candidate

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
    file_path = os.path.join("uploads", actual_filename)
    abs_path = os.path.abspath(file_path)
    if os.path.exists(file_path):
        try:
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode('utf-8')
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
        file_path = os.path.join(base_dir, "uploads", filename)
        
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Failed to delete file {file_path}: {e}")

    db.delete(candidate)
    db.commit()
    return {"status": "success", "message": "Candidate deleted successfully"}

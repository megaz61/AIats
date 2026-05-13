import os
import re
import json
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import models
from schemas import schemas
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

hf_api_key = os.getenv("HF_API_KEY")
client = AsyncOpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=hf_api_key
)

async def parse_job_description(description: str):
    prompt = f"""You are an HR assistant. Extract job requirements from the job description below.
Return ONLY a valid JSON object with exactly these keys. No extra text, no markdown, no code blocks.

- "required_skills": list of mandatory skills the candidate must have (array of strings)
- "preferred_skills": list of nice-to-have or bonus skills (array of strings, can be empty)
- "min_experience": minimum years of work experience required as an integer (use 0 if not specified)

Job Description:
{description}
"""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = await client.chat.completions.create(
                model="Qwen/Qwen2.5-7B-Instruct:together",
                messages=[
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=512,
            )
            ai_response = response.choices[0].message.content.strip()
            # Strip markdown fences if present
            if ai_response.startswith('```json'):
                ai_response = ai_response[7:]
                ai_response = ai_response[:ai_response.rfind('```')].strip() if '```' in ai_response else ai_response.strip()
            elif ai_response.startswith('```'):
                ai_response = ai_response[3:]
                ai_response = ai_response[:ai_response.rfind('```')].strip() if '```' in ai_response else ai_response.strip()
            if not ai_response.startswith('{'):
                match = re.search(r'\{[\s\S]*\}', ai_response)
                if match:
                    ai_response = match.group()
            return json.loads(ai_response)
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"JD parse error, retrying in {2 ** attempt}s... ({e})")
                await asyncio.sleep(2 ** attempt)
            else:
                print(f"Failed to parse JD after {max_retries} attempts:", e)
                return {"required_skills": [], "preferred_skills": [], "min_experience": 0}

@router.post("/", response_model=schemas.JobResponse)
async def create_job(job: schemas.JobCreate, db: Session = Depends(get_db)):
    parsed_jd = await parse_job_description(job.description)
    
    db_job = models.Job(
        title=job.title,
        description=job.description,
        required_skills=json.dumps(parsed_jd.get("required_skills", [])),
        preferred_skills=json.dumps(parsed_jd.get("preferred_skills", [])),
        min_experience=parsed_jd.get("min_experience", 0)
    )
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    return db_job

@router.get("/", response_model=list[schemas.JobResponse])
def get_jobs(db: Session = Depends(get_db)):
    jobs = db.query(models.Job).all()
    if not jobs:
        # Create a dummy job with parsed fields if DB is empty
        dummy_job = models.Job(
            title="IT Programmer",
            description="Mencari IT Programmer yang handal dengan kriteria:\n1. Menguasai bahasa pemrograman Python, JavaScript (Next.js, Node.js).\n2. Berpengalaman dengan database SQL (PostgreSQL, MySQL).\n3. Mampu bekerja dalam tim dan memiliki problem solving yang baik.\n4. Pengalaman minimal 2 tahun di bidang pengembangan software.",
            required_skills=json.dumps(["Python", "JavaScript", "Next.js", "Node.js", "SQL"]),
            preferred_skills=json.dumps(["PostgreSQL", "MySQL"]),
            min_experience=2
        )
        db.add(dummy_job)
        db.commit()
        db.refresh(dummy_job)
        jobs = [dummy_job]
    return jobs

@router.put("/{job_id}", response_model=schemas.JobResponse)
async def update_job(job_id: int, job: schemas.JobCreate, db: Session = Depends(get_db)):
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not db_job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    parsed_jd = await parse_job_description(job.description)
    
    db_job.title = job.title
    db_job.description = job.description
    db_job.required_skills = json.dumps(parsed_jd.get("required_skills", []))
    db_job.preferred_skills = json.dumps(parsed_jd.get("preferred_skills", []))
    db_job.min_experience = parsed_jd.get("min_experience", 0)
    
    db.commit()
    db.refresh(db_job)
    return db_job

@router.delete("/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db)):
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not db_job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(db_job)
    db.commit()
    return {"status": "success", "detail": "Job deleted"}

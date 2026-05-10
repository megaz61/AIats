import os
import json
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
    prompt = f"""Kamu adalah asisten HR. Ekstrak kriteria pekerjaan dari teks berikut. Kembalikan HANYA format JSON murni dengan keys:
'required_skills' (array of string), 'preferred_skills' (array of string), 'min_experience' (integer, 0 jika tidak ada). Jangan tambahkan teks lain.

Deskripsi Pekerjaan:
{description}
"""
    try:
        response = await client.chat.completions.create(
            model="meta-llama/Llama-3.1-8B-Instruct:novita",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=1024,
        )
        ai_response = response.choices[0].message.content.strip()
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:-3].strip()
        elif ai_response.startswith("```"):
            ai_response = ai_response[3:-3].strip()
            
        return json.loads(ai_response)
    except Exception as e:
        print("Failed to parse JD:", e)
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

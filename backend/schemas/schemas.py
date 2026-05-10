from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime

class JobBase(BaseModel):
    title: str
    description: str
    required_skills: Optional[str] = None
    preferred_skills: Optional[str] = None
    min_experience: Optional[int] = None

class JobCreate(JobBase):
    pass

class JobResponse(JobBase):
    id: int
    created_at: datetime
    class Config:
        from_attributes = True

class CandidateBase(BaseModel):
    name: str
    email: str
    skills: str
    education: Optional[str] = None
    experience_details: Optional[str] = None
    projects: Optional[str] = None
    experience_years: Optional[int] = None
    resume_url: Optional[str] = None
    job_id: int

class CandidateCreate(CandidateBase):
    pass

class CandidateResponse(CandidateBase):
    id: int
    match_score: Optional[float] = None
    score_breakdown: Optional[str] = None
    ai_summary: Optional[str] = None
    class Config:
        from_attributes = True

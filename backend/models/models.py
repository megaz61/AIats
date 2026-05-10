from sqlalchemy import Column, Integer, String, Text, Float, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=False)
    required_skills = Column(Text) # JSON string
    preferred_skills = Column(Text) # JSON string
    min_experience = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    candidates = relationship("Candidate", back_populates="job")

class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    skills = Column(Text) # JSON string
    education = Column(Text) # JSON string
    experience_details = Column(Text) # JSON string
    projects = Column(Text) # JSON string
    experience_years = Column(Integer)
    resume_url = Column(String)
    match_score = Column(Float)
    score_breakdown = Column(Text) # JSON string
    ai_summary = Column(Text)
    job_id = Column(Integer, ForeignKey("jobs.id"))

    job = relationship("Job", back_populates="candidates")

import os
import math
import json
import asyncio
from huggingface_hub import InferenceClient
from sqlalchemy.orm import Session
from models import models
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

hf_api_key = os.getenv("HF_API_KEY")
client_embed = InferenceClient(token=hf_api_key)
client_llm = AsyncOpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=hf_api_key
)

# Old embedding functions removed in favor of BGE-M3 via InferenceClient directly

async def calculate_and_save_match_score(db: Session, candidate_id: int):
    candidate = db.query(models.Candidate).filter(models.Candidate.id == candidate_id).first()
    if not candidate or not candidate.job_id:
        return None
    
    job = db.query(models.Job).filter(models.Job.id == candidate.job_id).first()
    if not job:
        return None
        
    def parse_json(text):
        if not text: return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list): return parsed
            return []
        except Exception: return []

    cand_skills = parse_json(candidate.skills)
    job_req = parse_json(job.required_skills)
    job_pref = parse_json(job.preferred_skills)

    cand_edu = parse_json(candidate.education)
    cand_exp_det = parse_json(candidate.experience_details)
    cand_proj = parse_json(candidate.projects)

    candidate_full_text = f"Skills: {', '.join(cand_skills)}\nEducation: {', '.join(cand_edu)}\nExperience: {', '.join(cand_exp_det)}\nProjects: {', '.join(cand_proj)}"

    # 1. Semantic Score (40%)
    job_text = ", ".join(job_req + job_pref) if (job_req or job_pref) else str(job.description)
    
    if not candidate_full_text.strip() or not job_text.strip():
        semantic_score = 0.0
    else:
        chunk_size = 1000
        overlap = 200
        chunks = []
        start = 0
        while start < len(candidate_full_text):
            end = start + chunk_size
            chunks.append(candidate_full_text[start:end])
            start += chunk_size - overlap
        if not chunks:
            chunks = [""]
            
        try:
            max_retries = 3
            result = None
            for attempt in range(max_retries):
                try:
                    result = client_embed.sentence_similarity(
                        job_text,
                        chunks,
                        model="BAAI/bge-m3",
                    )
                    break
                except Exception as e:
                    if attempt < max_retries - 1:
                        print(f"Embedding error, retrying in {2 ** attempt}s... ({e})")
                        await asyncio.sleep(2 ** attempt)
                    else:
                        raise e
            
            avg_score = sum(result) / len(result)
            
            THRESHOLD = 0.35
            if avg_score < THRESHOLD:
                normalized_score = 0.05 * (avg_score / THRESHOLD)
            else:
                normalized_score = avg_score
                
            semantic_score = normalized_score * 100
        except Exception as e:
            print(f"Embedding error: {e}")
            semantic_score = 0.0

    # 2. Hard Skill Match (30%)
    cand_skills_lower = [s.lower() for s in cand_skills]
    matched_req = []
    for req in job_req:
        if any(req.lower() in s or s in req.lower() for s in cand_skills_lower):
            matched_req.append(req)
            
    missing_req = [req for req in job_req if req not in matched_req]
    
    if job_req:
        skill_score = (len(matched_req) / len(job_req)) * 100
    else:
        skill_score = 100.0

    # 3. Experience Match (20%)
    min_exp = job.min_experience or 0
    cand_exp = candidate.experience_years or 0
    if min_exp > 0:
        if cand_exp >= min_exp:
            exp_score = 100.0
        else:
            exp_score = (cand_exp / min_exp) * 100.0
    else:
        exp_score = 100.0

    # 4. Education Match (10%)
    edu_score = 100.0 # Default

    final_score = (semantic_score * 0.4) + (skill_score * 0.3) + (exp_score * 0.2) + (edu_score * 0.1)

    # 5. Explainable AI Summary
    prompt = f"""You are an expert HR evaluator. Analyze the candidate profile against the job requirements and write your evaluation in Bahasa Indonesia using the EXACT format below. Do not add any text outside this format.

Job Requirements:
- Description: {job.description}
- Required skills: {', '.join(job_req) if job_req else 'Not specified'}
- Minimum experience: {min_exp} years

Candidate Profile:
- Skills: {', '.join(cand_skills) if cand_skills else 'Not listed'}
- Education: {', '.join(cand_edu) if cand_edu else 'Not listed'}
- Work Experience: {', '.join(cand_exp_det) if cand_exp_det else 'Not listed'}
- Projects: {', '.join(cand_proj) if cand_proj else 'Not listed'}
- Total Experience: {cand_exp} years
- Missing required skills: {', '.join(missing_req) if missing_req else 'None (all required skills are met)'}

Rules:
1. If candidate experience ({cand_exp} years) >= minimum required ({min_exp} years), this is a STRENGTH. NEVER list it as a weakness.
2. Write exactly 2-3 bullet points under Kelebihan.
3. Write exactly 1-2 bullet points under Kekurangan. If no real weaknesses, write the least critical gap.
4. Verdict must be one concise sentence in Bahasa Indonesia.

Kelebihan:
- [point 1]
- [point 2]

Kekurangan:
- [point 1]

Verdict: [one sentence]"""
    
    max_retries = 3
    ai_summary = "Kandidat memiliki beberapa keahlian relevan namun perlu ditinjau lebih lanjut."
    for attempt in range(max_retries):
        try:
            response = await client_llm.chat.completions.create(
                model="Qwen/Qwen2.5-7B-Instruct:together",
                messages=[
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=600,
            )
            ai_summary = response.choices[0].message.content.strip()
            break
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"LLM Error, retrying in {2 ** attempt}s... ({e})")
                await asyncio.sleep(2 ** attempt)
            else:
                print("LLM Error after retries:", e)

    candidate.match_score = round(final_score, 2)
    candidate.score_breakdown = json.dumps({
        "semantic_score": round(semantic_score, 2),
        "skill_match": round(skill_score, 2),
        "experience_match": round(exp_score, 2),
        "education_match": round(edu_score, 2),
        "missing_skills": missing_req,
        "matched_skills": matched_req
    })
    candidate.ai_summary = ai_summary

    db.commit()
    db.refresh(candidate)
    
    return candidate.match_score

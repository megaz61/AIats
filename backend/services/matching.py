import os
import math
import json
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

def get_embedding(text: str):
    try:
        data = client_embed.feature_extraction(text, model="sentence-transformers/all-MiniLM-L6-v2")
        if hasattr(data, "tolist"):
            data = data.tolist()
            
        if isinstance(data, list) and len(data) > 0:
            if isinstance(data[0], list):
                return data[0]
            return data
        return data
    except Exception as e:
        print(f"Embedding error: {e}")
        return [0.0] * 384

def cosine_similarity(v1, v2):
    dot_product = sum(a * b for a, b in zip(v1, v2))
    norm_a = math.sqrt(sum(a * a for a in v1))
    norm_b = math.sqrt(sum(b * b for b in v2))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot_product / (norm_a * norm_b)

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

    # 1. Semantic Score (40%)
    candidate_text = ", ".join(cand_skills) if cand_skills else ""
    job_text = ", ".join(job_req + job_pref) if (job_req or job_pref) else str(job.description)
    
    if not candidate_text.strip() or not job_text.strip():
        semantic_score = 0.0
    else:
        emb_candidate = get_embedding(candidate_text)
        emb_job = get_embedding(job_text)
        semantic_score = cosine_similarity(emb_candidate, emb_job) * 100

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
    prompt = f"""Kamu adalah asisten HR. Buat ringkasan evaluasi 2 kalimat tentang kandidat ini.
Kandidat memiliki skill: {', '.join(cand_skills)}.
Kandidat kekurangan skill wajib: {', '.join(missing_req) if missing_req else 'Tidak ada'}.
Pengalaman kandidat: {cand_exp} tahun (Syarat minimum: {min_exp} tahun).
Jelaskan kelebihan dan kekurangannya secara profesional tanpa bertele-tele.
Jika Bahasa yang digunakan didalam CV berbeda dengan bahasa yang ada di dekripsi atau kriteria maka translate dulu ke dalam bahasa yang sama sebelum mengevaluasi"""
    
    try:
        response = await client_llm.chat.completions.create(
            model="meta-llama/Llama-3.1-8B-Instruct:novita",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=150,
        )
        ai_summary = response.choices[0].message.content.strip()
    except Exception as e:
        print("LLM Error:", e)
        ai_summary = "Kandidat memiliki beberapa keahlian relevan namun perlu ditinjau lebih lanjut."

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

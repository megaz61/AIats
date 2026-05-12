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
            result = client_embed.sentence_similarity(
                job_text,
                chunks,
                model="BAAI/bge-m3",
            )
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
    prompt = f"""Kamu adalah asisten HR. Evaluasi kandidat ini berdasarkan Kriteria Pekerjaan dan Teks CV Kandidat.
Bandingkan secara langsung kriteria yang diminta dengan pengalaman/skill yang ada di CV.

Aturan Penting:
1. Jika pengalaman kandidat LEBIH dari atau SAMA DENGAN pengalaman minimal yang diminta, ini adalah hal bagus. Masukkan sebagai "Kelebihan", JANGAN PERNAH memasukkannya sebagai "Kekurangan".
2. Jika kandidat belum memenuhi syarat, gunakan frasa "kurang cocok" (jangan gunakan kata "tidak cocok").

Kriteria Pekerjaan:
{job.description}
Kriteria wajib: {', '.join(job_req)}
Pengalaman minimal: {min_exp} tahun

Teks CV Kandidat:
{candidate_full_text}
Pengalaman kandidat: {cand_exp} tahun

Kandidat kekurangan skill wajib: {', '.join(missing_req) if missing_req else 'Tidak ada'}.

Buat output HANYA dengan struktur persis seperti berikut tanpa tambahan apa pun (gunakan format Markdown):
Kelebihan:
- [Poin 1]
- [Poin 2]

Kekurangan:
- [Poin 1]
- [Poin 2]

Verdict: [Satu kalimat rekomendasi ringkas apakah kandidat ini cocok atau kurang cocok]"""
    
    try:
        response = await client_llm.chat.completions.create(
            model="meta-llama/Llama-3.1-8B-Instruct:novita",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=300,
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

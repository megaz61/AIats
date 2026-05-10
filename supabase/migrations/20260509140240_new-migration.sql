CREATE TABLE jobs (
    id SERIAL PRIMARY KEY,
    title VARCHAR NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_jobs_id ON jobs (id);
CREATE INDEX ix_jobs_title ON jobs (title);

CREATE TABLE candidates (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    email VARCHAR NOT NULL UNIQUE,
    skills TEXT,
    experience_years INTEGER,
    resume_url VARCHAR,
    match_score DOUBLE PRECISION,
    job_id INTEGER REFERENCES jobs(id)
);

CREATE INDEX ix_candidates_id ON candidates (id);
CREATE INDEX ix_candidates_name ON candidates (name);
CREATE INDEX ix_candidates_email ON candidates (email);

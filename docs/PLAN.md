# ESAT Exam Builder — Build Plan

## Domain

Three Oxbridge admissions tests:

- **ESAT** — Maths 1, Maths 2, Physics, Chemistry, Biology, Advanced Maths.
- **ENGAA** — Section 1 (Maths/Physics), Section 2 (Advanced).
- **NSAA** — Section 1, Section 2 (subject-specific).

Almost all questions are **multiple choice (A–E)**. Mark schemes are
typically answer-key tables, not worked solutions.

## Schema (see `infra/db/migrations/`)

```
exams(id, test_code, year, sitting, source_pdf_path, ms_pdf_path, status)
sections(id, exam_id, code, question_count)
questions(id, section_id, number, image_path, ocr_text,
          answer_key, topic_id, difficulty, summary, keywords)
topics(id, section_code, code, name)         -- flat (no LO hierarchy)
question_topics(question_id, topic_id, confidence)
papers_drafts(id, owner_id, name, items, time_limit_minutes, instructions)
saved_papers(id, draft_id, qp_pdf_path, ms_pdf_path)
flags(id, question_id, user_id, note, status)
users(id, google_id, email, role)            -- role: teacher|admin (student later)
sessions(id, user_id, token, expires_at)
```

## Phases

### Phase 0 — Bootstrap (this scaffold)
- Repo structure, package manifests, Docker/Compose, cloudbuild.yaml.
- Empty migration shells. Topic seed for ESAT Physics.
- Stub API/extractor/frontend that boot but do nothing useful.

### Phase 1 — Schema + ingest skeleton
- Fill in migrations.
- `POST /exams/upload` — accept QP + MS PDFs, persist to storage.
- MS answer-key parser (text extraction → `{Q# → A-E}` map).

### Phase 2 — MCQ clipper
- PyMuPDF-based detector for numbered MCQ blocks.
- Render clip → PNG, OCR sidecar.
- Validate against ≥10 past papers across ESAT/ENGAA/NSAA.

### Phase 3 — Categoriser + topic seed
- Curate topic seeds for Maths 1/2, Chemistry, Biology, Advanced Maths.
- Gemini 2.5 Flash vision prompt → `{ topic_code, difficulty, keywords, summary }`.
- Concurrency throttle + 429 backoff (port from CAIE).

### Phase 4 — Frontend
- Library (filter by test/section/topic/year/difficulty).
- Builder (drag-drop, live total).
- Upload, Edit, Login.

### Phase 5 — Export + Generate
- pdf-lib composition with section dividers + answer-key MS.
- Random paper generator with section + topic constraints.

### Phase 6 — Auth + roles
- Google OAuth (port H6 from CAIE).
- `users.role` enum, allowlist.

### Phase 7 — Hardening + UAT
- Bug fixes, real-teacher trial.

## Reused from CAIE

- GCP infra patterns (Cloud Run, Cloud SQL, GCS, Secret Manager).
- Storage abstraction (local/GCS switch).
- Auth pattern (opaque session tokens + Google OAuth).
- LLM call wrapper (concurrency limiter + retry/backoff).
- pdf-lib composition + renumber overlay.
- React + Tailwind + dnd-kit frontend scaffolding.

## Rebuilt for ESAT

- Question schema (no `question_parts`, no LOs).
- `question_type` reduces to `multiple_choice | short_answer | structured`.
- `answer_key` is first-class.
- Marker/clipping heuristics (different layouts).
- Topic taxonomy (flat, sourced from official ESAT guides).

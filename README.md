# ESAT Exam Builder

Past-paper question library and exam builder for Oxbridge admissions tests
(ESAT, ENGAA, NSAA). Lets teachers ingest official past papers, browse and
filter questions by section/topic, and assemble custom papers targeting
specific topics.

> Forked-by-design from `caie-exam-builder`. Shares its architecture
> (Node API + Python extractor + React frontend on GCP) but with a fresh
> domain model suited to multi-section MCQ admissions tests.

## Status

**Phase 0 — scaffolding.** Directory structure and stubs only. No working
extraction or categorisation yet. See `docs/PLAN.md` for the phased
build plan.

## Layout

```
api/                Node 20 + Express + TypeScript orchestrator
extractor/          Python + FastAPI + PyMuPDF PDF service
frontend/           React 19 + Vite + Tailwind 4 SPA
packages/
  shared-types/     TypeScript types shared by api + frontend
infra/
  db/               node-pg-migrate migrations + seeds
  gcp/              (placeholder for terraform / deploy scripts)
syllabus/           Topic seed JSON (ESAT spec, see screenshot)
```

## Quick start (local dev — once stubs are filled in)

```bash
docker compose up -d                      # postgres on :5434
npm install
cd extractor && python -m venv .venv && \
  source .venv/bin/activate && \
  pip install -r requirements.txt
npm run migrate:up && npm run seed

# three terminals:
npm run dev:api          # :8082
npm run dev:extractor    # :8081
npm run dev:frontend     # :5173
```

## Tests covered

| Test  | Sections                                            |
|-------|-----------------------------------------------------|
| ESAT  | Maths 1, Maths 2, Physics, Chemistry, Biology, Advanced Maths |
| ENGAA | Section 1 (Maths/Physics), Section 2 (Advanced)     |
| NSAA  | Section 1, Section 2 (subject-specific)             |

## Licence / source material

Past paper PDFs are © Cambridge Assessment Admissions Testing. This
repo's source code is internal-use only; PDF source files are not
committed (see `.gitignore`).

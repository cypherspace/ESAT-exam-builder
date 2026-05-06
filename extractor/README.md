# Extractor

Python FastAPI service. Wraps PyMuPDF to clip MCQ blocks from ESAT/ENGAA/NSAA
question papers and parse answer-key tables from mark schemes.

## Local dev

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8081
```

## Endpoints

- `POST /extract` — clip QP + parse MS, returns `ExtractResult`.
- `POST /render` — render a single page region (used by admin crop UI).
- `GET /healthz`.

## Phase status

Phase 0 — stubs only. Returns 501 Not Implemented for `/extract` and `/render`.

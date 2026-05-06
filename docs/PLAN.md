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
          answer_key, topic_id, difficulty, summary, keywords,
          page_index, bbox)
topics(id, section_code, code, name)         -- flat (no LO hierarchy)
question_topics(question_id, topic_id, confidence)
paper_drafts(id, owner_id, name, items, time_limit_minutes, instructions)
saved_papers(id, draft_id, qp_pdf_path, ms_pdf_path)
flags(id, question_id, user_id, note, status)
users(id, google_id, email, role)            -- role: teacher|admin (student later)
sessions(id, user_id, token, expires_at)
```

## Status snapshot (2026-05-06)

| Phase | State | Notes |
|-------|-------|-------|
| 0 — Bootstrap | ✅ done | Initial scaffold from CAIE transit copy. |
| 1 — Schema + ingest skeleton | ✅ done | DB pool, storage helper (local + GCS), `/exams/upload`, `/files`, `/topics`, `/questions`, MS parser. |
| 2 — MCQ clipper | 🟡 code-complete, needs fixture tuning | Section-aware marker detector + clipper land on the cloud branch; thresholds need tuning against real ESAT/ENGAA/NSAA PDFs. **Pick up here on local.** |
| 3 — Gemini categoriser | ⏳ pending | |
| 4 — Frontend (Library/Builder/Edit) | ⏳ pending | |
| 5 — Export + Generate | ⏳ pending | |
| 6 — Google OAuth | ⏳ pending | |
| 7 — Hardening + UAT | ⏳ pending | |

The active dev branch is `claude/push-esat-scaffold-KGoNa`. Phases 3, 5, 6 are
being built from a cloud Claude Code session in parallel because they don't
need fixtures.

## Local-session handoff (Phase 2 tuning)

The cloud session can't reach Google Drive / Dropbox / arbitrary URLs from
its sandbox, so Phase 2 fixture work has been deferred to a local Claude
Code session.

### Setup

```bash
git checkout claude/push-esat-scaffold-KGoNa
git pull
mkdir -p fixtures
# drop PDFs into fixtures/<test>/<year>_<sitting>/{qp.pdf,ms.pdf}
# fixtures/ is matched by the existing `*.pdf` and "Past Papers" .gitignore
# entries — verify with `git status` before committing.
docker compose up -d                         # postgres on :5435
npm install
cd extractor && python -m venv .venv && \
  source .venv/bin/activate && \
  pip install -r requirements.txt
cd ..
npm run migrate:up && npm run seed
# three terminals:
npm run dev:api          # :8082
npm run dev:extractor    # :8081
npm run dev:frontend     # :5173
```

### What works end-to-end now

- `POST /api/v1/exams/upload` (multer FormData: `qp`, `ms`, `test_code`,
  `year`, `sitting`, optional `default_section`) writes PDFs to
  `STORAGE_DIR`, upserts an `exams` row, seeds `sections` rows for the
  test, and fires the extractor pipeline asynchronously.
- The extractor pipeline (`extractor/app.py /extract`) runs
  `clip_mcq_questions()` → renders per-question PNGs under
  `STORAGE_DIR/exams/<id>/clips/<section>/qNN.png` → parses the MS answer
  key per section → returns the structured payload.
- `api/src/services/ingest.ts` persists clipped questions into Postgres
  with `image_path`, `bbox`, `page_index`, and `answer_key` fields, then
  rolls `exams.status` to `ready`.
- `GET /api/v1/exams/:id` shows status + per-section question counts.
- `GET /files?u=<file://...>` streams clipped PNGs back to the frontend.

### What needs tuning (the local-session work)

The extractor heuristics are first-cut and **definitely** need adjustment
against real PDFs:

- `extractor/pipeline/markers.py` — `detect_markers()` defaults:
  - `min_size=9.5`, `max_size=13.0` — body-text font band.
  - `max_x0=90.0` — left-margin x-position cap (visual coords).
  - `min_y=50.0` — header strip cutoff.
  - `require_bold=False` — flip to True if you see false positives from
    body-text digits.
  - `SECTION_PATTERNS` — case-insensitive regexes that promote the
    "active section" page-by-page. The ENGAA / NSAA section headers may
    not match the current ESAT-centric patterns; add new entries.
- `extractor/pipeline/mcq_clipper.py` — `TOP_PAD_PT=8.0`,
  `BOTTOM_PAD_PT=30.0`, `DPI=200`. The clipper assumes one MCQ per
  vertical strip and uses the next marker on the same page (and same
  section) as `y_bottom`. Verify there's no glue between adjacent MCQs
  or hard cutoff inside an option list.
- `extractor/pipeline/ms_parser.py` — `_ROW_RE` covers `12 A`, `Q12 A`,
  `12 | A`, `12: A`, `12.A` shapes. If real MSes use a different row
  shape (e.g. side-by-side multi-column tables, "Q1 → A", multi-letter
  rationale prefixes) extend the regex and add unit tests under
  `extractor/tests/test_ms_parser.py`.

### Suggested local validation loop

1. Drop one ESAT QP+MS pair into `fixtures/esat/2024_october/`.
2. `curl -F qp=@fixtures/esat/2024_october/qp.pdf -F ms=@fixtures/esat/2024_october/ms.pdf -F test_code=ESAT -F year=2024 -F sitting=October http://localhost:8082/api/v1/exams/upload`
3. Watch `STORAGE_DIR/exams/<id>/clips/<section>/q*.png` pop out.
4. Eyeball a few clips. Adjust `markers.py` / `mcq_clipper.py` thresholds
   as needed; rerun via `POST /api/v1/exams/:id/extract`.
5. Once clipping is clean for ESAT, repeat for ENGAA and NSAA.
6. Add the MS parser regex extensions you needed as test cases.

### Validation target (from the plan)

> Validate against ≥10 past papers across ESAT/ENGAA/NSAA.

Once the heuristics hold across that set, commit the tuned thresholds
plus any new section-pattern entries, and push back to the same branch.
The cloud session will pick up Phase 3 from there.

## Phases

### Phase 0 — Bootstrap (done)
Repo structure, package manifests, Docker/Compose, cloudbuild.yaml.
Empty migration shells. Topic seed for ESAT Physics.
Stub API/extractor/frontend that boot but do nothing useful.

### Phase 1 — Schema + ingest skeleton (done)
- Filled-in migrations.
- `POST /exams/upload` — accepts QP + MS PDFs, persists to storage.
- MS answer-key parser (text extraction → `{section: {Q# → A-E}}` map).
- `GET /files?u=...` — streams local file URIs.
- `GET /topics?section=…` — section-filtered topic list.
- `GET /questions?...` — paginated, filterable on
  `test_code`/`section`/`topic_id`/`year`/`difficulty_min`/`difficulty_max`.

### Phase 2 — MCQ clipper (code complete; needs fixture tuning)
- PyMuPDF-based marker detection with section-aware boundaries.
- Clip render → PNG at 200 DPI; OCR sidecar via `page.get_textbox`.
- Persist `questions` rows with `image_path`, `bbox`, `page_index`,
  `answer_key` keyed by `(section, number)`.
- `POST /api/v1/exams/:id/extract` to retry after tuning.
- **Validate against ≥10 past papers across ESAT/ENGAA/NSAA.** ← local.

### Phase 3 — Categoriser + topic seed (pending)
- Curate topic seeds for Maths 1/2, Chemistry, Biology, Advanced Maths
  from official ESAT subject guides.
- Gemini 2.5 Flash vision prompt → `{ topic_code, difficulty, keywords, summary }`.
- Concurrency throttle + 429 backoff (port from CAIE).
- `POST /api/v1/exams/:id/categorise` to run categorisation across all
  questions for an exam.

### Phase 4 — Frontend (pending)
- Library (filter by test/section/topic/year/difficulty).
- Builder (drag-drop, live total).
- Upload, Edit, Login.

### Phase 5 — Export + Generate (pending)
- pdf-lib composition with section dividers + answer-key MS.
- Random paper generator with section + topic constraints.

### Phase 6 — Auth + roles (pending)
- Google OAuth (port H6 from CAIE).
- `users.role` enum, allowlist.

### Phase 7 — Hardening + UAT (pending)
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
- `answer_key` is first-class, keyed `(section_code, number)`.
- Marker/clipping heuristics (different layouts, multiple sections per PDF).
- Topic taxonomy (flat, sourced from official ESAT guides).

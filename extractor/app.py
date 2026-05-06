"""ESAT extractor service.

FastAPI app. Endpoints:
  POST /extract  — clip MCQ blocks from a question paper, parse answer key
                   from the mark scheme PDF, return a structured payload.
  POST /render   — render a single page region to PNG (used by the
                   admin crop UI to refine clips).
  GET  /healthz  — liveness.

Phase 0: stubs only. Phase 2 fills in the clipping logic.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="esat-extractor", version="0.1.0")


class ExtractRequest(BaseModel):
    exam_id: str
    test_code: str  # ESAT | ENGAA | NSAA
    qp_path: str  # storage URI (local or gs://)
    ms_path: str | None = None


class RenderRequest(BaseModel):
    pdf_path: str
    page_index: int
    bbox: list[float] | None = None  # [x0, y0, x1, y1] in PDF points


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/extract")
def extract(_req: ExtractRequest) -> dict:
    raise HTTPException(status_code=501, detail="not_implemented (phase 2)")


@app.post("/render")
def render(_req: RenderRequest) -> dict:
    raise HTTPException(status_code=501, detail="not_implemented (phase 2)")

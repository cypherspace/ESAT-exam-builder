"""ESAT extractor service.

FastAPI app. Endpoints:
  POST /extract-ms — parse the answer key out of a mark scheme PDF.
  POST /extract    — full clip pipeline (Phase 2): clip MCQ blocks, OCR,
                     plus the answer key from the MS.
  POST /render     — render a single page region to PNG (used by the
                     admin crop UI to refine clips).
  GET  /healthz    — liveness.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from pipeline import storage
from pipeline.ms_parser import parse_answer_key

app = FastAPI(title="esat-extractor", version="0.1.0")


class ExtractMsRequest(BaseModel):
    ms_uri: str


class ExtractRequest(BaseModel):
    exam_id: str
    test_code: str  # ESAT | ENGAA | NSAA
    qp_uri: str
    ms_uri: str | None = None


class RenderRequest(BaseModel):
    pdf_uri: str
    page_index: int
    bbox: list[float] | None = None  # [x0, y0, x1, y1] in PDF points


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/extract-ms")
def extract_ms(req: ExtractMsRequest) -> dict:
    try:
        local = storage.resolve_uri_to_local(req.ms_uri)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        answer_key, warnings = parse_answer_key(local)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"ms_parse_failed: {exc}")
    return {"answer_key": answer_key, "warnings": warnings}


@app.post("/extract")
def extract(_req: ExtractRequest) -> dict:
    raise HTTPException(status_code=501, detail="not_implemented (phase 2)")


@app.post("/render")
def render(_req: RenderRequest) -> dict:
    raise HTTPException(status_code=501, detail="not_implemented (phase 2)")

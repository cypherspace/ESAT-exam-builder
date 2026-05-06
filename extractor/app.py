"""ESAT extractor service.

FastAPI app. Endpoints:
  POST /extract-ms — parse the answer key out of a mark scheme PDF.
  POST /extract    — full clip pipeline: clip MCQ blocks per section
                     from the QP, parse the answer key from the MS, and
                     return both for the API to persist.
  POST /render     — render a single page region to PNG (used by the
                     admin crop UI to refine clips). Phase Q.
  GET  /healthz    — liveness.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

# Load the project-root .env so STORAGE_DIR (and any other settings) match
# what the API uses. Must run before pipeline.* imports because storage.py
# reads STORAGE_DIR at module-import time on first call.
from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
if _ENV_PATH.exists():
    load_dotenv(_ENV_PATH)

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from pipeline import storage
from pipeline.ms_parser import parse_answer_key
from pipeline.mcq_clipper import clip_mcq_questions

app = FastAPI(title="esat-extractor", version="0.1.0")


TestCode = Literal["ESAT", "ENGAA", "NSAA"]


class ExtractMsRequest(BaseModel):
    ms_uri: str
    default_section: str | None = None


class ExtractRequest(BaseModel):
    exam_id: str
    test_code: TestCode
    qp_uri: str
    ms_uri: str | None = None
    default_section: str | None = None  # for single-section booklets
    # ESAT papers restart numbering at 1 in each section; ENGAA/NSAA papers
    # use continuous Q1..QN across the whole paper. The clipper needs to
    # know which mode to apply when filtering candidates to strict 1..N.
    continuous_numbering: bool = False


class RenderRequest(BaseModel):
    pdf_uri: str
    page_index: int
    bbox: list[float] | None = None  # [x0, y0, x1, y1] in PDF points
    dpi: int = 200


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
        answer_key, warnings = parse_answer_key(
            local, default_section=req.default_section,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"ms_parse_failed: {exc}")
    return {"answer_key": answer_key, "warnings": warnings}


@app.post("/extract")
def extract(req: ExtractRequest) -> dict:
    try:
        qp_local = storage.resolve_uri_to_local(req.qp_uri)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"qp_uri: {exc}")

    out_prefix = f"exams/{req.exam_id}/clips"
    warnings: list[str] = []
    try:
        clipped = clip_mcq_questions(
            qp_local,
            out_prefix=out_prefix,
            default_section=req.default_section,
            continuous_numbering=req.continuous_numbering,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"clip_failed: {exc}")

    if not clipped:
        warnings.append(
            "no markers detected — heuristic thresholds may need tuning "
            "for this paper's layout"
        )

    answer_key: dict[str, dict[int, str]] = {}
    if req.ms_uri:
        try:
            ms_local = storage.resolve_uri_to_local(req.ms_uri)
            answer_key, ms_warnings = parse_answer_key(
                ms_local, default_section=req.default_section,
            )
            warnings.extend(ms_warnings)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"ms_parse_failed: {exc}")

    return {
        "exam_id": req.exam_id,
        "test_code": req.test_code,
        "questions": [q.model_dump() for q in clipped],
        "answer_key": answer_key,
        "warnings": warnings,
    }


@app.post("/render")
def render(req: RenderRequest) -> Response:
    import fitz  # local import — avoids import cost on healthz hits

    try:
        pdf_local = storage.resolve_uri_to_local(req.pdf_uri)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    doc = fitz.open(pdf_local)
    try:
        if req.page_index < 0 or req.page_index >= len(doc):
            raise HTTPException(status_code=400, detail="page_index out of range")
        page = doc[req.page_index]
        scale = req.dpi / 72.0
        mat = fitz.Matrix(scale, scale)
        if req.bbox is not None:
            if len(req.bbox) != 4:
                raise HTTPException(status_code=400, detail="bbox must be [x0,y0,x1,y1]")
            pix = page.get_pixmap(matrix=mat, clip=fitz.Rect(*req.bbox), alpha=False)
        else:
            pix = page.get_pixmap(matrix=mat, alpha=False)
        png_bytes = pix.tobytes("png")
        page_w = page.rect.width
        page_h = page.rect.height
        total_pages = len(doc)
    finally:
        doc.close()

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "x-page-width-pts": str(page_w),
            "x-page-height-pts": str(page_h),
            "x-total-pages": str(total_pages),
        },
    )

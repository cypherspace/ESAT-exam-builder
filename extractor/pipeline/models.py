"""Pydantic types shared across pipeline modules."""

from __future__ import annotations

from pydantic import BaseModel


class ClippedQuestion(BaseModel):
    section_code: str  # MATHS1 | MATHS2 | PHYSICS | CHEMISTRY | BIOLOGY | ADV_MATHS
    number: int
    page_index: int
    bbox: tuple[float, float, float, float]  # x0, y0, x1, y1 in PDF points
    # Original question-number marker bbox (x, y, w, h) in source PDF
    # points. Persisted so the export composer can paint over the original
    # number when renumbering. None for pre-marker-bbox rows.
    marker_bbox: tuple[float, float, float, float] | None = None
    image_uri: str
    ocr_text: str


class ExtractResult(BaseModel):
    exam_id: str
    questions: list[ClippedQuestion]
    answer_key: dict[int, str]  # question_number -> 'A'|'B'|'C'|'D'|'E'
    warnings: list[str]

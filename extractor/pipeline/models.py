"""Pydantic types shared across pipeline modules."""

from __future__ import annotations

from pydantic import BaseModel


class ClippedQuestion(BaseModel):
    number: int
    page_index: int
    bbox: tuple[float, float, float, float]  # x0, y0, x1, y1 in PDF points
    image_path: str
    ocr_text: str


class ExtractResult(BaseModel):
    exam_id: str
    questions: list[ClippedQuestion]
    answer_key: dict[int, str]  # question_number -> 'A'|'B'|'C'|'D'|'E'

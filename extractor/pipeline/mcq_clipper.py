"""Clip MCQ blocks (stem + options A-E) from question paper pages.

Phase 2: implement. Strategy:
  - Use markers.detect_markers() to get question top-edges.
  - For each marker N, the bottom is the y_top of marker N+1 on the same
    page (or page bottom if N is the last on that page).
  - Render the [y_top(N), y_bottom(N)] horizontal strip at 200 DPI.
  - Extract OCR text for the same strip via page.get_text("text", clip=...).
"""

from __future__ import annotations

from .models import ClippedQuestion


def clip_mcq_questions(_pdf_path: str) -> list[ClippedQuestion]:
    raise NotImplementedError("phase 2")

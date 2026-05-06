"""Detect numbered question markers in ESAT/ENGAA/NSAA MCQ pages.

Phase 2: implement. Strategy:
  - Walk text blocks via PyMuPDF.
  - Heuristic: a question marker is a left-margin numeral (often bold)
    immediately followed by a stem on the same or next line.
  - Numbers must be strictly increasing across the section.
  - Return a list of (question_number, page_index, y_top) tuples.
"""

from __future__ import annotations


def detect_markers(_pdf_path: str) -> list[tuple[int, int, float]]:
    raise NotImplementedError("phase 2")

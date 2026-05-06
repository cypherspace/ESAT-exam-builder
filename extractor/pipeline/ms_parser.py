"""Parse ESAT/ENGAA/NSAA mark scheme PDFs.

Mark schemes are typically tables of {Q# -> A|B|C|D|E}. Some include a
short justification per question — we capture it when present but it's
optional.

Phase 1: implement. Strategy:
  - Extract text via PyMuPDF page.get_text().
  - Regex for lines like ^(\\d+)\\s+([ABCDE])\\b.* and aggregate.
  - Validate: keys must be contiguous from 1..N (warn on gaps).
"""

from __future__ import annotations


def parse_answer_key(_ms_pdf_path: str) -> dict[int, str]:
    raise NotImplementedError("phase 1")

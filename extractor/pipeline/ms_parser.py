"""Parse ESAT/ENGAA/NSAA mark scheme PDFs.

Mark schemes are typically tables of {Q# -> A|B|C|D|E}. ESAT MSes bundle
multiple subject sections in one PDF with section headers separating
them, mirroring the QP layout. We track the current section as we scan
pages and return a section-keyed answer key so callers can match answers
to questions by (section_code, number).

Strategy:
  - Walk every page text via PyMuPDF page.get_text("text").
  - Page-level scan first updates the active section if a section header
    is present (re-using markers.SECTION_PATTERNS).
  - Per-line regex matches '12 C' / 'Q12 C' / '12 | C' style rows.
  - Aggregate per section; warn (don't raise) on conflicts and gaps.
"""

from __future__ import annotations

import re
from typing import Iterable

# Local import — avoid pulling in PyMuPDF at import time (used by tests).
_ROW_RE = re.compile(
    r"""^\s*
        (?:Q\.?\s*)?           # optional Q. or Q prefix
        (\d{1,3})              # question number
        \s*[\.\)\|\:]?\s*       # separator (dot, paren, pipe, colon)
        ([A-Ea-e])             # answer letter (case-insensitive)
        \b
    """,
    re.VERBOSE,
)


def _iter_pages(pdf_path: str) -> Iterable[str]:
    import fitz  # PyMuPDF — lazy import so unit tests don't need it

    with fitz.open(pdf_path) as doc:
        for page in doc:
            yield page.get_text("text") or ""


def parse_answer_key(
    ms_pdf_path: str,
    *,
    default_section: str | None = None,
) -> tuple[dict[str, dict[int, str]], list[str]]:
    """Return ({section_code: {q_num: 'A'..'E'}}, warnings).

    `default_section` is used until a section header is encountered, and
    for single-section MS booklets that have no header at all (e.g.
    ENGAA Section 1 alone).
    """
    from .markers import SECTION_PATTERNS  # avoid a circular at module import

    answers: dict[str, dict[int, str]] = {}
    conflicts: list[tuple[str, int, str, str]] = []
    active = default_section or "MATHS1"

    for page_text in _iter_pages(ms_pdf_path):
        # update active section if this page mentions a header
        for pat, code in SECTION_PATTERNS:
            if pat.search(page_text):
                active = code
                break

        for line in page_text.splitlines():
            m = _ROW_RE.match(line)
            if not m:
                continue
            n = int(m.group(1))
            a = m.group(2).upper()
            section_map = answers.setdefault(active, {})
            if n in section_map and section_map[n] != a:
                conflicts.append((active, n, section_map[n], a))
                continue
            section_map[n] = a

    warnings: list[str] = []
    if not answers:
        warnings.append("no answers matched in MS PDF — check format")
        return answers, warnings

    for sec, n, prev, new in conflicts:
        warnings.append(f"{sec} Q{n}: conflicting answers {prev}/{new}; kept {prev}")

    for sec, m in answers.items():
        expected = max(m)
        missing = [n for n in range(1, expected + 1) if n not in m]
        if missing:
            warnings.append(f"{sec}: missing answers for Q#: {missing}")

    return answers, warnings

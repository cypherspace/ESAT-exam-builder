"""Parse ESAT/ENGAA/NSAA mark scheme PDFs.

Mark schemes are typically tables of {Q# -> A|B|C|D|E}. Some include a
short justification per question — we capture it when present but it's
optional.

Strategy:
  - Walk every page text via PyMuPDF page.get_text("text").
  - Match lines like  '12  C'  or  '12 | C'  or  'Q12  C  some note...'.
  - Aggregate; ignore duplicates with consistent answers, warn on conflicts.
  - Validate contiguity 1..N; warn (don't raise) on gaps.
"""

from __future__ import annotations

import re
from typing import Iterable

_ROW_RE = re.compile(
    r"""^\s*
        (?:Q\.?\s*)?           # optional Q. or Q prefix
        (\d{1,3})              # question number
        \s*[\.\)\|\:]?\s*       # separator (dot, paren, pipe, colon)
        ([A-Ea-e])             # answer letter (case-insensitive)
        \b                     # word boundary so '12 AB' isn't matched
    """,
    re.VERBOSE,
)


def _iter_lines(pdf_path: str) -> Iterable[str]:
    import fitz  # PyMuPDF — imported lazily so unit tests don't need it

    with fitz.open(pdf_path) as doc:
        for page in doc:
            text = page.get_text("text")
            for line in text.splitlines():
                yield line


def parse_answer_key(ms_pdf_path: str) -> tuple[dict[int, str], list[str]]:
    """Return (answer_key, warnings).

    answer_key maps Q-number -> 'A'|'B'|'C'|'D'|'E'.
    warnings is a list of human-readable problems we tolerated.
    """
    answers: dict[int, str] = {}
    conflicts: list[tuple[int, str, str]] = []
    for line in _iter_lines(ms_pdf_path):
        m = _ROW_RE.match(line)
        if not m:
            continue
        n = int(m.group(1))
        a = m.group(2).upper()
        if n in answers and answers[n] != a:
            conflicts.append((n, answers[n], a))
            continue
        answers[n] = a

    warnings: list[str] = []
    if not answers:
        warnings.append("no answers matched in MS PDF — check format")
        return {}, warnings

    for n, prev, new in conflicts:
        warnings.append(f"Q{n}: conflicting answers {prev}/{new}; kept {prev}")

    expected = max(answers)
    missing = [n for n in range(1, expected + 1) if n not in answers]
    if missing:
        warnings.append(f"missing answers for Q#: {missing}")

    return answers, warnings

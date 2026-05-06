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
# Answer letter is broadened to A-Z because some Cambridge admissions
# papers print MCQs with more than 5 options (we've seen up to 8 in
# fixture review).
_ROW_RE = re.compile(
    r"""^\s*
        (?:Q\.?\s*)?           # optional Q. or Q prefix
        (\d{1,3})              # question number
        \s*[\.\)\|\:]?\s*       # separator (dot, paren, pipe, colon)
        ([A-Za-z])             # answer letter (case-insensitive, broad range)
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

        # Try the per-line shape first ("12 C", "Q12 C", "12 | C").
        matched_inline = False
        for line in page_text.splitlines():
            m = _ROW_RE.match(line)
            if not m:
                continue
            matched_inline = True
            n = int(m.group(1))
            a = m.group(2).upper()
            section_map = answers.setdefault(active, {})
            if n in section_map and section_map[n] != a:
                conflicts.append((active, n, section_map[n], a))
                continue
            section_map[n] = a

        # Fallback: ENGAA / NSAA mark schemes print number and letter on
        # separate lines (each digit and each answer is its own line in the
        # extracted text). Pair adjacent number/letter lines.
        if not matched_inline:
            lines = [ln.strip() for ln in page_text.splitlines() if ln.strip()]
            i = 0
            while i < len(lines) - 1:
                # 2016-19 papers print bare digits ("1"); 2020+ papers
                # prefix the digit with "Q" ("Q1").
                num_match = re.fullmatch(r"(?:Q\.?)?(\d{1,3})", lines[i])
                ans_match = re.fullmatch(r"[A-Za-z]", lines[i + 1])
                if num_match and ans_match:
                    n = int(num_match.group(1))
                    a = ans_match.group(0).upper()
                    if 1 <= n <= 999:
                        section_map = answers.setdefault(active, {})
                        if n in section_map and section_map[n] != a:
                            conflicts.append((active, n, section_map[n], a))
                        else:
                            section_map[n] = a
                    i += 2
                else:
                    i += 1

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

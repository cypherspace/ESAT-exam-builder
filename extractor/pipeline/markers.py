"""Detect numbered question markers in ESAT/ENGAA/NSAA MCQ papers.

ESAT papers bundle multiple subject sections (Maths 1, Maths 2, Physics,
Chemistry, Biology, Advanced Maths) into one PDF. Each section restarts
numbering at 1, so markers can't be a simple strictly-increasing 1..N
sequence across the whole document. We detect section boundaries via the
section header text printed at the start of each section and emit
markers grouped by section.

ENGAA / NSAA share the same MCQ marker shape; we use the same heuristics
for them but with section-name patterns specific to each test.

Heuristics (first cut — TUNE against fixtures):
  - Bare 1-3 digit numerals at the left margin (x0 ≤ 80pt visual coords).
  - Body-text size band (9.5–13pt by default).
  - Bold preferred but not required (some specs print plain weight).
  - Strictly increasing 1..N within each detected section.

Section detection: page-by-page scan for one of the SECTION_PATTERNS
markers; the first hit on a page transitions the active section.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Iterable

if TYPE_CHECKING:
    import fitz  # noqa: F401  (only used for type hints)


@dataclass
class Marker:
    page: int                # 0-indexed
    section_code: str        # MATHS1 | MATHS2 | PHYSICS | CHEMISTRY | BIOLOGY | ADV_MATHS
    question_number: int
    x: float
    y: float
    w: float
    h: float


# Map of section name regex (case-insensitive, on the page text) -> section_code.
# These are intentionally loose: ESAT/ENGAA/NSAA cover pages and section
# dividers use varied phrasings ("Section: Mathematics 1", "Mathematics 1
# Section A", "Paper 2 — Physics", etc.).
SECTION_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(?:section\s*[:\-]?\s*)?advanced\s*math(?:ematic)?s\b", re.I), "ADV_MATHS"),
    (re.compile(r"\b(?:section\s*[:\-]?\s*)?math(?:ematic)?s\s*(?:paper|section)?\s*1\b", re.I), "MATHS1"),
    (re.compile(r"\b(?:section\s*[:\-]?\s*)?math(?:ematic)?s\s*(?:paper|section)?\s*2\b", re.I), "MATHS2"),
    (re.compile(r"\b(?:section\s*[:\-]?\s*)?physics\b", re.I), "PHYSICS"),
    (re.compile(r"\b(?:section\s*[:\-]?\s*)?chemistry\b", re.I), "CHEMISTRY"),
    (re.compile(r"\b(?:section\s*[:\-]?\s*)?biology\b", re.I), "BIOLOGY"),
]

_BARE_Q_RE = re.compile(r"^\s*(\d{1,3})(?=\s*\(|\s*$|\s)")


def _detect_section(text: str) -> str | None:
    """Return the first section code whose pattern matches; None otherwise.

    When a page mentions multiple section names (rare but possible — e.g.
    a contents page), the earliest match in the regex priority order wins.
    Note we check ADV_MATHS before MATHS1/2 because "Advanced Mathematics"
    contains "Mathematics".
    """
    for pat, code in SECTION_PATTERNS:
        if pat.search(text):
            return code
    return None


def _iter_spans(page: "fitz.Page") -> Iterable[dict]:
    for block in page.get_text("dict")["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                yield span


def _visual_rect(bbox: tuple[float, float, float, float], page: "fitz.Page") -> "fitz.Rect":
    import fitz

    return fitz.Rect(*bbox) * page.rotation_matrix


@dataclass
class _Candidate:
    page: int
    n: int
    x: float
    y: float
    w: float
    h: float
    size: float
    font: str


def _bare_digit_candidates(
    page: "fitz.Page",
    *,
    page_index: int,
    min_size: float,
    max_size: float,
    max_x0: float,
    min_y: float,
) -> list[_Candidate]:
    out: list[_Candidate] = []
    for span in _iter_spans(page):
        m = _BARE_Q_RE.match(span["text"])
        if not m:
            continue
        n = int(m.group(1))
        if not (1 <= n <= 99):
            continue
        if span["size"] < min_size or span["size"] > max_size:
            continue
        vrect = _visual_rect(span["bbox"], page)
        if vrect.x0 > max_x0 or vrect.y0 < min_y:
            continue
        out.append(_Candidate(
            page=page_index, n=n,
            x=vrect.x0, y=vrect.y0, w=vrect.width, h=vrect.height,
            size=span["size"], font=span.get("font", ""),
        ))
    return out


def detect_markers(
    pdf_path: str,
    *,
    min_size: float = 9.5,
    max_size: float = 13.0,
    max_x0: float = 90.0,
    min_y: float = 50.0,
    require_bold: bool = False,
    default_section: str | None = None,
) -> list[Marker]:
    """Find MCQ question markers grouped by detected section.

    `default_section` is used when the PDF doesn't carry section headers
    (e.g. extracted single-section booklets). For ENGAA Section 1 / NSAA
    Section 1 papers callers may pass 'MATHS1' to shortcut detection.
    """
    import fitz

    doc = fitz.open(pdf_path)
    try:
        # Pass 1 — collect all candidates and the running section per page.
        active = default_section or "MATHS1"
        page_section: list[str] = []
        per_page_candidates: list[list[_Candidate]] = []
        for pi in range(len(doc)):
            page = doc[pi]
            text = page.get_text("text") or ""
            detected = _detect_section(text)
            if detected:
                active = detected
            page_section.append(active)
            per_page_candidates.append(
                _bare_digit_candidates(
                    page,
                    page_index=pi,
                    min_size=min_size,
                    max_size=max_size,
                    max_x0=max_x0,
                    min_y=min_y,
                )
            )
    finally:
        doc.close()

    if require_bold:
        per_page_candidates = [
            [c for c in cs if "Bold" in c.font]
            for cs in per_page_candidates
        ]

    # Pass 2 — bucket candidates by section and emit a strictly-increasing
    # 1..N sequence per section (sorting by reading order first).
    by_section: dict[str, list[_Candidate]] = {}
    for pi, candidates in enumerate(per_page_candidates):
        section = page_section[pi]
        by_section.setdefault(section, []).extend(candidates)

    markers: list[Marker] = []
    for section, cands in by_section.items():
        cands.sort(key=lambda c: (c.page, c.y, c.x))
        expected = 1
        for c in cands:
            if c.n == expected:
                markers.append(Marker(
                    page=c.page, section_code=section, question_number=c.n,
                    x=c.x, y=c.y, w=c.w, h=c.h,
                ))
                expected += 1

    markers.sort(key=lambda m: (m.page, m.y))
    return markers

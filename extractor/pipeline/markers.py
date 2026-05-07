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


# Patterns matched per LINE on a section-divider page. Order matters:
# numbered/advanced variants come before the bare "Mathematics" fallback so
# "Mathematics 2" doesn't get picked up as MATHS1.
SECTION_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bmath(?:ematic)?s\s*(?:paper|section)?\s*2\b", re.I), "MATHS2"),
    (re.compile(r"\bmath(?:ematic)?s\s*(?:paper|section)?\s*1\b", re.I), "MATHS1"),
    # "Advanced Mathematics" maps to MATHS2 — the topic taxonomies are the
    # same (algebra & functions, sequences, calculus, …).
    (re.compile(r"\badvanced\s*math(?:ematic)?s\b", re.I), "MATHS2"),
    (re.compile(r"\bphysics\b", re.I), "PHYSICS"),
    (re.compile(r"\bchemistry\b", re.I), "CHEMISTRY"),
    (re.compile(r"\bbiology\b", re.I), "BIOLOGY"),
    # Plain "Mathematics" / "Maths" — NSAA "Part A Mathematics" and PAT
    # "Section A — Mathematics for Physics" both land here.
    (re.compile(r"\bmath(?:ematic)?s\b", re.I), "MATHS1"),
]

# A section header in these papers always carries a "PART X" or "SECTION N"
# prefix — e.g. "PART A Mathematics", "PART B Physics", "SECTION 2",
# "Section A" (PAT format). Cover instructions and table-of-contents lines
# mention subject names in prose, so we filter to lines with this prefix
# to avoid spurious transitions.
_SECTION_PREFIX_RE = re.compile(
    r"^\s*(?:PART\s+[A-Z]\b|SECTION\s+(?:[A-Z]|\d+)\b)",
    re.I,
)
# TOC entries look like "PART A Mathematics .................... 1" — kill
# anything with dot leaders followed by a page number.
_TOC_LEADER_RE = re.compile(r"\.{3,}\s*\d+\s*$")

# Match a bare question number — "1", "1 ", "1.\n", "1.  Foo". The
# optional `\.?` makes us tolerant of PAT-style "1." markers without
# letting "10.5" fool us (the lookahead requires the next char after
# any trailing dot to be whitespace, EOL, or `(` — not another digit).
_BARE_Q_RE = re.compile(
    r"^\s*(\d{1,3})(?:\.)?\s*(?=\(|$|\s|[A-Z])"
)


def _detect_section(text: str) -> str | None:
    """Return the section code for the first section-divider line on the page.

    A page is a divider only if it contains a line that:
      1. Starts with "PART X" or "SECTION N";
      2. Is not a table-of-contents entry (no dot leaders + page number);
      3. Mentions exactly one subject (e.g. "PART A Mathematics" → MATHS1).
         Lines naming multiple subjects ("PART A Mathematics and Physics" in
         older ENGAA papers) are ignored — the categoriser handles routing
         per-question for those mixed parts.
    """
    for line in text.splitlines():
        if not _SECTION_PREFIX_RE.match(line):
            continue
        if _TOC_LEADER_RE.search(line):
            continue
        # Lines that mention "Advanced" anywhere route to MATHS2 even when
        # multiple subjects are named (e.g. "PART E Advanced Mathematics
        # and Advanced Physics" in NSAA / ENGAA Section 2). The Advanced-
        # Physics questions inside that part are then re-routed to PHYSICS
        # by the categoriser based on content.
        if re.search(r"\badvanced\b", line, re.I):
            return "MATHS2"
        # Collect every distinct subject this line names.
        hits: list[str] = []
        for pat, code in SECTION_PATTERNS:
            if pat.search(line) and code not in hits:
                hits.append(code)
        if len(hits) == 1:
            return hits[0]
        # Zero or multiple subjects — leave the active section unchanged.
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
    max_x0: float = 130.0,
    min_y: float = 50.0,
    require_bold: bool = False,
    default_section: str | None = None,
    continuous_numbering: bool = False,
) -> list[Marker]:
    """Find MCQ question markers grouped by detected section.

    `default_section` is used when the PDF doesn't carry section headers
    (e.g. extracted single-section booklets). For ENGAA Section 1 / NSAA
    Section 1 papers callers may pass 'MATHS1' to shortcut detection.

    `continuous_numbering` controls whether the strict 1..N filter is applied
    per section (ESAT — each section restarts at 1) or globally across the
    whole paper (ENGAA / NSAA — continuous numbering Q1..QN regardless of
    section header). In global mode each marker still carries the
    section_code that was active on its page, so downstream consumers can
    still group by section.
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

    markers: list[Marker] = []

    if continuous_numbering:
        # Pass 2a — global strict-increasing 1..N across the whole paper.
        # Each marker takes the section code that was active on its page.
        all_cands: list[tuple[_Candidate, str]] = []
        for pi, candidates in enumerate(per_page_candidates):
            for c in candidates:
                all_cands.append((c, page_section[pi]))
        all_cands.sort(key=lambda t: (t[0].page, t[0].y, t[0].x))
        expected = 1
        for c, section in all_cands:
            if c.n == expected:
                markers.append(Marker(
                    page=c.page, section_code=section, question_number=c.n,
                    x=c.x, y=c.y, w=c.w, h=c.h,
                ))
                expected += 1
    else:
        # Pass 2b — per-section strict-increasing 1..N (each section
        # restarts numbering at 1, ESAT-style).
        by_section: dict[str, list[_Candidate]] = {}
        for pi, candidates in enumerate(per_page_candidates):
            section = page_section[pi]
            by_section.setdefault(section, []).extend(candidates)

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

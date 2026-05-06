"""Clip MCQ blocks (stem + options A-E) from question paper pages.

Strategy (first cut — TUNE against fixtures):
  - markers.detect_markers() yields per-section markers with (page, y_top).
  - For each marker N in a section: y_bottom is either the y_top of the
    next marker on the same page, or the lowest content y on the page +
    BOTTOM_PAD (last marker on its page).
  - Render the strip [y_top - TOP_PAD, y_bottom] at DPI to a PNG.
  - Extract OCR via page.get_textbox(clip_rect).
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from .markers import Marker, detect_markers
from .models import ClippedQuestion
from .storage import write_bytes

if TYPE_CHECKING:
    import fitz  # noqa: F401
    from PIL import Image as _PILImage  # noqa: F401


DPI = 200
TOP_PAD_PT = 8.0
BOTTOM_PAD_PT = 30.0


def _lowest_content_y(page: "fitz.Page") -> float:
    bottom = 0.0
    for block in page.get_text("dict")["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                bottom = max(bottom, span["bbox"][3])
    for img in page.get_images(full=True):
        try:
            bbox = page.get_image_bbox(img)
            bottom = max(bottom, bbox.y1)
        except Exception:
            pass
    return bottom


def _render_clip(page: "fitz.Page", y_top: float, y_bottom: float):
    import fitz
    from PIL import Image

    scale = DPI / 72.0
    rect = fitz.Rect(0, y_top, page.rect.width, y_bottom)
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, clip=rect, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def _save_png(img, key: str) -> str:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return write_bytes(key, buf.getvalue())


def clip_mcq_questions(
    pdf_path: str,
    *,
    out_prefix: str,
    default_section: str | None = None,
    continuous_numbering: bool = False,
) -> list[ClippedQuestion]:
    """Render per-question PNGs and return ClippedQuestion records.

    `out_prefix` is a storage key prefix (e.g. `exams/<exam_id>/clips`).
    `continuous_numbering`: pass True for ENGAA/NSAA (one continuous Q1..QN
    sequence across the paper); leave False for ESAT (each section restarts
    at Q1).
    """
    import fitz

    markers = detect_markers(
        pdf_path,
        default_section=default_section,
        continuous_numbering=continuous_numbering,
    )
    if not markers:
        return []

    # Group markers by (section, page) so "next marker on same page" lookup
    # respects section boundaries: a Maths1 Q14 marker should not look at
    # the first Physics marker on the same physical page if a section
    # header straddles the page mid-way.
    doc = fitz.open(pdf_path)
    try:
        results: list[ClippedQuestion] = []
        for i, m in enumerate(markers):
            page = doc[m.page]
            y_top = max(0.0, m.y - TOP_PAD_PT)

            next_m: Marker | None = None
            if i + 1 < len(markers):
                cand = markers[i + 1]
                if cand.section_code == m.section_code and cand.page == m.page:
                    next_m = cand

            if next_m is not None:
                y_bottom = max(y_top + 1.0, next_m.y - TOP_PAD_PT)
            else:
                y_bottom = min(page.rect.height, _lowest_content_y(page) + BOTTOM_PAD_PT)

            img = _render_clip(page, y_top, y_bottom)
            key = f"{out_prefix}/{m.section_code.lower()}/q{m.question_number:02d}.png"
            uri = _save_png(img, key)

            clip_rect = fitz.Rect(0, y_top, page.rect.width, y_bottom)
            text = page.get_textbox(clip_rect).strip()

            results.append(ClippedQuestion(
                section_code=m.section_code,
                number=m.question_number,
                page_index=m.page,
                bbox=(0.0, y_top, page.rect.width, y_bottom),
                image_uri=uri,
                ocr_text=text,
            ))
        return results
    finally:
        doc.close()

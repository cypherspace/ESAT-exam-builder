/**
 * Compose a draft into a question paper PDF and a mark scheme PDF using
 * pdf-lib. ESAT MCQs are small clipped strips: we stack multiple per
 * page with a vertical gap, just like CAIE Paper 1.
 *
 * Output:
 *   - QP PDF: cover page + section dividers + clipped question images,
 *     each renumbered 1..N per the draft order.
 *   - MS PDF: a single answer-key table mapping renumbered Q -> A-E.
 *
 * Storage URIs returned via the storage helper.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { AnswerKey, SectionCode } from '@esat/shared-types';
import { readBytes, writeBytes } from '../storage.js';
import { query } from '../db.js';
import { SECTION_LABEL } from './labels.js';

export type ExportMode = 'separate' | 'interleaved' | 'sequential';

export interface ComposerInput {
  draftId: string;
  title: string;
  timeLimitMinutes: number | null;
  instructions: string | null;
  itemQuestionIds: string[]; // already in draft order; blanks resolved out
  mode: ExportMode;
  includeCover: boolean;
}

export interface ComposerOutput {
  // 'separate' returns two URIs.
  qp_uri?: string;
  ms_uri?: string;
  // 'interleaved' / 'sequential' returns one combined URI.
  combined_uri?: string;
  mode: ExportMode;
}

interface QuestionRow {
  id: string;
  number: number;
  image_path: string;
  answer_key: AnswerKey | null;
  section_code: SectionCode;
  test_code: string;
  year: number;
  sitting: string;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  marker_bbox: { x: number; y: number; w: number; h: number } | null;
}

const A4 = { width: 595.28, height: 841.89 };
const SIDE_MARGIN = 36;
const TOP_MARGIN = 36;
const BOTTOM_MARGIN = 36;
const STACK_GAP = 18;
// Source PDF page width assumed for scale derivation. Cambridge admissions
// papers are A4 throughout — 595 pt. The composer scales each clip to
// (A4.width - 2 * SIDE_MARGIN) so the source-pt → export-pt scale is
// effectively (max image width) / (source page width).
const SOURCE_PAGE_WIDTH = 595.28;
// Slop pixels around the marker bbox when painting over it, in source-pt.
const MARKER_COVER_PAD = 2;
// Fallback rect (in source PDF points) when marker_bbox is null. Covers
// the typical "1." area in the top-left of a Cambridge admissions clip.
const FALLBACK_MARKER_PT = { x: 36, y: 8, w: 30, h: 16 };

export async function composeDraft(input: ComposerInput): Promise<ComposerOutput> {
  const questions = await loadQuestions(input.itemQuestionIds);
  const slug = input.draftId;

  if (input.mode === 'separate') {
    const qp = await buildQp(input, questions);
    const ms = await buildMs(input, questions);
    const qpUri = await writeBytes(`drafts/${slug}/qp.pdf`, Buffer.from(qp));
    const msUri = await writeBytes(`drafts/${slug}/ms.pdf`, Buffer.from(ms));
    return { mode: 'separate', qp_uri: qpUri, ms_uri: msUri };
  }
  if (input.mode === 'interleaved') {
    const combined = await buildInterleaved(input, questions);
    const uri = await writeBytes(`drafts/${slug}/interleaved.pdf`, Buffer.from(combined));
    return { mode: 'interleaved', combined_uri: uri };
  }
  // sequential — all questions, then a separator, then the answer-key page.
  const combined = await buildSequential(input, questions);
  const uri = await writeBytes(`drafts/${slug}/sequential.pdf`, Buffer.from(combined));
  return { mode: 'sequential', combined_uri: uri };
}

async function loadQuestions(ids: string[]): Promise<QuestionRow[]> {
  if (ids.length === 0) return [];
  // Preserve draft order: query with `WHERE id = ANY($1)` then re-order client-side.
  const rows = await query<QuestionRow>(
    `SELECT q.id, q.number, q.image_path, q.answer_key, q.bbox, q.marker_bbox,
            s.code AS section_code, e.test_code, e.year, e.sitting
     FROM questions q
     JOIN sections s ON s.id = q.section_id
     JOIN exams e ON e.id = s.exam_id
     WHERE q.id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(rows.rows.map((r) => [r.id, r]));
  const ordered: QuestionRow[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r) ordered.push(r);
  }
  return ordered;
}

async function buildQp(
  input: ComposerInput,
  questions: QuestionRow[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  if (input.includeCover) {
    drawCover(doc, fontReg, fontBold, input);
  }

  // Group questions by section to allow per-section dividers.
  const groups = groupBySection(questions);
  let displayNumber = 0;

  for (const group of groups) {
    // Section divider page.
    const div = doc.addPage([A4.width, A4.height]);
    div.drawText(SECTION_LABEL[group.section], {
      x: SIDE_MARGIN,
      y: A4.height - 200,
      size: 28,
      font: fontBold,
    });
    div.drawText(`${group.questions.length} questions`, {
      x: SIDE_MARGIN,
      y: A4.height - 232,
      size: 12,
      font: fontReg,
      color: rgb(0.3, 0.3, 0.3),
    });

    // Stacked clip pages.
    let page = doc.addPage([A4.width, A4.height]);
    let cursorY = A4.height - TOP_MARGIN;
    for (const q of group.questions) {
      displayNumber += 1;
      const pngBytes = await readBytes(q.image_path);
      const img = await doc.embedPng(pngBytes);
      const maxWidth = A4.width - 2 * SIDE_MARGIN;
      const scale = Math.min(1, maxWidth / img.width);
      const w = img.width * scale;
      const h = img.height * scale;

      // New page if it doesn't fit.
      if (cursorY - h - 20 < BOTTOM_MARGIN) {
        page = doc.addPage([A4.width, A4.height]);
        cursorY = A4.height - TOP_MARGIN;
      }

      const imageX = SIDE_MARGIN;
      const imageTopY = cursorY;
      page.drawImage(img, {
        x: imageX,
        y: cursorY - h,
        width: w,
        height: h,
      });

      // Cover the original Q number on the embedded clip and draw the
      // running number in its place. Compute the cover rect (in export
      // PDF points) from the marker bbox stored at clip time.
      drawRenumber({
        page,
        fontBold,
        displayNumber,
        imageX,
        imageTopY,
        imagePtWidth: w,
        clipBbox: q.bbox,
        markerBbox: q.marker_bbox,
      });

      cursorY -= h + STACK_GAP;
    }
  }

  return doc.save();
}

async function buildMs(
  input: ComposerInput,
  questions: QuestionRow[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([A4.width, A4.height]);
  page.drawText(`${input.title} — Mark Scheme`, {
    x: SIDE_MARGIN,
    y: A4.height - TOP_MARGIN - 6,
    size: 16,
    font: fontBold,
  });

  // Table layout: 4-column grid of "N. X" entries.
  const cols = 4;
  const colWidth = (A4.width - 2 * SIDE_MARGIN) / cols;
  const rowHeight = 18;
  let row = 0;
  questions.forEach((q, i) => {
    const display = i + 1;
    const colIdx = display % cols === 0 ? cols - 1 : (display - 1) % cols;
    if (colIdx === 0 && display !== 1) row += 1;
    const x = SIDE_MARGIN + colIdx * colWidth;
    const y = A4.height - TOP_MARGIN - 40 - row * rowHeight;
    page.drawText(`${display}. ${q.answer_key ?? '—'}`, {
      x,
      y,
      size: 11,
      font: fontReg,
    });
  });

  // Provenance footer.
  const footerY = BOTTOM_MARGIN;
  page.drawText(
    `Composed from ${questions.length} questions across ${countTests(questions)} exam${
      countTests(questions) === 1 ? '' : 's'
    }.`,
    {
      x: SIDE_MARGIN,
      y: footerY,
      size: 9,
      font: fontReg,
      color: rgb(0.5, 0.5, 0.5),
    },
  );

  return doc.save();
}

async function buildInterleaved(
  input: ComposerInput,
  questions: QuestionRow[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  if (input.includeCover) drawCover(doc, fontReg, fontBold, input);

  let displayNumber = 0;
  for (const q of questions) {
    displayNumber += 1;
    // One question per page, followed by a small mark-scheme strip on the
    // next page. Keeps the user's "next" muscle memory predictable.
    const qPage = doc.addPage([A4.width, A4.height]);
    await drawQuestionOnPage(qPage, doc, q, displayNumber, fontBold);

    const msPage = doc.addPage([A4.width, A4.height]);
    msPage.drawText(`Question ${displayNumber} — answer`, {
      x: SIDE_MARGIN,
      y: A4.height - TOP_MARGIN - 6,
      size: 14,
      font: fontBold,
    });
    msPage.drawText(q.answer_key ?? '—', {
      x: SIDE_MARGIN,
      y: A4.height - TOP_MARGIN - 60,
      size: 60,
      font: fontBold,
      color: rgb(0.05, 0.4, 0.2),
    });
    msPage.drawText(
      `(${SECTION_LABEL[q.section_code]} · ${q.test_code} ${q.year} ${q.sitting} · originally Q${q.number})`,
      {
        x: SIDE_MARGIN,
        y: A4.height - TOP_MARGIN - 90,
        size: 9,
        font: fontReg,
        color: rgb(0.4, 0.4, 0.4),
      },
    );
  }
  return doc.save();
}

async function buildSequential(
  input: ComposerInput,
  questions: QuestionRow[],
): Promise<Uint8Array> {
  // All questions first, then the answer-key table — single combined PDF.
  const qpBuf = await buildQp(input, questions);
  const msBuf = await buildMs({ ...input, includeCover: false }, questions);

  const out = await PDFDocument.create();
  const qpDoc = await PDFDocument.load(qpBuf);
  const msDoc = await PDFDocument.load(msBuf);
  const qpPages = await out.copyPages(qpDoc, qpDoc.getPageIndices());
  const msPages = await out.copyPages(msDoc, msDoc.getPageIndices());
  for (const p of qpPages) out.addPage(p);
  for (const p of msPages) out.addPage(p);
  return out.save();
}

async function drawQuestionOnPage(
  page: import('pdf-lib').PDFPage,
  _doc: PDFDocument,
  q: QuestionRow,
  displayNumber: number,
  fontBold: import('pdf-lib').PDFFont,
): Promise<void> {
  const pngBytes = await readBytes(q.image_path);
  const img = await _doc.embedPng(pngBytes);
  const maxWidth = A4.width - 2 * SIDE_MARGIN;
  const scale = Math.min(1, maxWidth / img.width);
  const w = img.width * scale;
  const h = img.height * scale;
  const imageX = SIDE_MARGIN;
  const imageTopY = A4.height - TOP_MARGIN;
  page.drawImage(img, { x: imageX, y: imageTopY - h, width: w, height: h });
  drawRenumber({
    page,
    fontBold,
    displayNumber,
    imageX,
    imageTopY,
    imagePtWidth: w,
    clipBbox: q.bbox,
    markerBbox: q.marker_bbox,
  });
}

function drawCover(
  doc: PDFDocument,
  fontReg: import('pdf-lib').PDFFont,
  fontBold: import('pdf-lib').PDFFont,
  input: ComposerInput,
): void {
  const cover = doc.addPage([A4.width, A4.height]);
  cover.drawText(input.title, {
    x: SIDE_MARGIN,
    y: A4.height - 120,
    size: 22,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  if (input.timeLimitMinutes) {
    cover.drawText(`Time allowed: ${input.timeLimitMinutes} minutes`, {
      x: SIDE_MARGIN,
      y: A4.height - 156,
      size: 12,
      font: fontReg,
      color: rgb(0.2, 0.2, 0.2),
    });
  }
  if (input.instructions) {
    drawWrapped(cover, input.instructions, {
      x: SIDE_MARGIN,
      yTop: A4.height - 196,
      width: A4.width - 2 * SIDE_MARGIN,
      size: 11,
      lineHeight: 14,
      font: fontReg,
    });
  }
}

/**
 * Paint a white rectangle over the original Q number on the embedded
 * clip image and draw the new running number in its place.
 *
 * Coordinates: marker_bbox is stored in source PDF points, where the
 * source page is 595 pt wide. The export embeds the clip image at the
 * page's full content width (A4 - 2*sideMargin = 523 pt). So the
 * conversion from source-pt to export-pt is the same scale we use for
 * the image: imagePtWidth / imagePxWidth (pdf-lib treats one image
 * pixel as 1 pt). We don't have imagePxWidth in source-pt directly, but
 * we know the image was rendered at DPI=200 from a source page of
 * SOURCE_PAGE_WIDTH points, so:
 *
 *   imagePxWidth = SOURCE_PAGE_WIDTH * (200 / 72)
 *   exportScale  = imagePtWidth / imagePxWidth
 *                = imagePtWidth * 72 / (SOURCE_PAGE_WIDTH * 200)
 *
 * Marker bbox in export-pt is then `markerBboxSrc * exportScale`.
 */
function drawRenumber(args: {
  page: import('pdf-lib').PDFPage;
  fontBold: import('pdf-lib').PDFFont;
  displayNumber: number;
  imageX: number;
  imageTopY: number; // PDF-pt y of the image's top edge
  imagePtWidth: number;
  clipBbox: { x0: number; y0: number; x1: number; y1: number } | null;
  markerBbox: { x: number; y: number; w: number; h: number } | null;
}): void {
  // Source-page-pt → export-pt scale, derived from the image's rendered
  // size in the export PDF.
  const exportScale =
    (args.imagePtWidth * 72) / (SOURCE_PAGE_WIDTH * 200);

  // Marker bbox in source-pt, relative to the clip's top-left.
  let mx: number, my: number, mw: number, mh: number;
  if (args.markerBbox && args.clipBbox) {
    mx = args.markerBbox.x - args.clipBbox.x0;
    my = args.markerBbox.y - args.clipBbox.y0;
    mw = args.markerBbox.w;
    mh = args.markerBbox.h;
  } else {
    // Pre-marker_bbox row — fall back to a reasonable top-left rect.
    mx = FALLBACK_MARKER_PT.x;
    my = FALLBACK_MARKER_PT.y;
    mw = FALLBACK_MARKER_PT.w;
    mh = FALLBACK_MARKER_PT.h;
  }

  // To export-pt, with slop, then place relative to the embedded image.
  const padPt = MARKER_COVER_PAD;
  const coverX = args.imageX + (mx - padPt) * exportScale;
  const coverYTop = args.imageTopY - (my - padPt) * exportScale;
  const coverWidth = (mw + 2 * padPt) * exportScale;
  const coverHeight = (mh + 2 * padPt) * exportScale;

  // pdf-lib drawRectangle uses bottom-left + (width, height) with y-axis
  // bottom-up.
  args.page.drawRectangle({
    x: coverX,
    y: coverYTop - coverHeight,
    width: coverWidth,
    height: coverHeight,
    color: rgb(1, 1, 1),
  });

  // Draw the new running number centred horizontally inside the cover
  // rect. Use a font size that fills ~80% of the cover height so it
  // matches the original number's visual weight.
  const fontSize = Math.max(9, coverHeight * 0.72);
  const label = String(args.displayNumber);
  const textWidth = args.fontBold.widthOfTextAtSize(label, fontSize);
  const textX = coverX + Math.max(0, (coverWidth - textWidth) / 2);
  // pdf-lib drawText anchors at the text's baseline; nudge so it sits
  // inside the cover rect with a small descent buffer.
  const textY = coverYTop - coverHeight + (coverHeight - fontSize) / 2 + 2;

  args.page.drawText(label, {
    x: textX,
    y: textY,
    size: fontSize,
    font: args.fontBold,
  });
}

function groupBySection(
  questions: QuestionRow[],
): { section: SectionCode; questions: QuestionRow[] }[] {
  const out: { section: SectionCode; questions: QuestionRow[] }[] = [];
  let current: { section: SectionCode; questions: QuestionRow[] } | null = null;
  for (const q of questions) {
    if (!current || current.section !== q.section_code) {
      current = { section: q.section_code, questions: [] };
      out.push(current);
    }
    current.questions.push(q);
  }
  return out;
}

function countTests(questions: QuestionRow[]): number {
  const set = new Set<string>();
  for (const q of questions) set.add(`${q.test_code}-${q.year}-${q.sitting}`);
  return set.size;
}

function drawWrapped(
  page: import('pdf-lib').PDFPage,
  text: string,
  opts: {
    x: number;
    yTop: number;
    width: number;
    size: number;
    lineHeight: number;
    font: import('pdf-lib').PDFFont;
  },
): number {
  const words = text.split(/\s+/);
  let line = '';
  let y = opts.yTop;
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (opts.font.widthOfTextAtSize(probe, opts.size) > opts.width) {
      page.drawText(line, { x: opts.x, y, size: opts.size, font: opts.font });
      y -= opts.lineHeight;
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) {
    page.drawText(line, { x: opts.x, y, size: opts.size, font: opts.font });
    y -= opts.lineHeight;
  }
  return y;
}

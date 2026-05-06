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

export interface ComposerInput {
  draftId: string;
  title: string;
  timeLimitMinutes: number | null;
  instructions: string | null;
  itemQuestionIds: string[]; // already in draft order; blanks resolved out
}

export interface ComposerOutput {
  qp_uri: string;
  ms_uri: string;
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
}

const A4 = { width: 595.28, height: 841.89 };
const SIDE_MARGIN = 36;
const TOP_MARGIN = 36;
const BOTTOM_MARGIN = 36;
const STACK_GAP = 18;

export async function composeDraft(input: ComposerInput): Promise<ComposerOutput> {
  const questions = await loadQuestions(input.itemQuestionIds);
  const qp = await buildQp(input, questions);
  const ms = await buildMs(input, questions);

  const slug = input.draftId;
  const qpUri = await writeBytes(`drafts/${slug}/qp.pdf`, Buffer.from(qp));
  const msUri = await writeBytes(`drafts/${slug}/ms.pdf`, Buffer.from(ms));
  return { qp_uri: qpUri, ms_uri: msUri };
}

async function loadQuestions(ids: string[]): Promise<QuestionRow[]> {
  if (ids.length === 0) return [];
  // Preserve draft order: query with `WHERE id = ANY($1)` then re-order client-side.
  const rows = await query<QuestionRow>(
    `SELECT q.id, q.number, q.image_path, q.answer_key,
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

  // Cover page.
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
      const maxWidth = A4.width - 2 * SIDE_MARGIN - 28; // 28pt for "N." label
      const scale = Math.min(1, maxWidth / img.width);
      const w = img.width * scale;
      const h = img.height * scale;

      // New page if it doesn't fit.
      if (cursorY - h - 20 < BOTTOM_MARGIN) {
        page = doc.addPage([A4.width, A4.height]);
        cursorY = A4.height - TOP_MARGIN;
      }

      // Draw renumbered marker.
      page.drawText(`${displayNumber}.`, {
        x: SIDE_MARGIN,
        y: cursorY - 14,
        size: 12,
        font: fontBold,
      });
      page.drawImage(img, {
        x: SIDE_MARGIN + 28,
        y: cursorY - h,
        width: w,
        height: h,
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

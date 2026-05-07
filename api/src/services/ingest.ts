/**
 * Ingest pipeline: drive the extractor, persist clipped questions and the
 * MS-derived answer key into Postgres, and roll the exam status forward.
 *
 * Called from POST /exams/upload (and POST /exams/:id/extract for retries).
 */

import type { AnswerKey, SectionCode, TestCode } from '@esat/shared-types';
import { query } from '../db.js';
import { extractor, type ExtractedQuestion } from '../extractor.js';

interface IngestArgs {
  examId: string;
  testCode: TestCode;
  qpUri: string;
  msUri: string | null;
  defaultSection?: SectionCode;
}

export async function ingestExam(args: IngestArgs): Promise<{
  questions_inserted: number;
  warnings: string[];
}> {
  await query(`UPDATE exams SET status = 'extracting' WHERE id = $1`, [args.examId]);
  try {
    // ESAT papers restart numbering at 1 in each section; ENGAA / NSAA /
    // PAT bundle multiple subject sections in one paper with continuous
    // numbering across the whole booklet.
    const continuous =
      args.testCode === 'ENGAA' ||
      args.testCode === 'NSAA' ||
      args.testCode === 'PAT';
    // PAT papers mix MCQ and long-form questions — drop the long-form
    // ones at clip time. The other tests are all-MCQ.
    const mcqOnly = args.testCode === 'PAT';
    // PAT mark schemes are worked solutions, not answer-key tables; the
    // existing MS parser misreads them as e.g. "Q12 = M, Q12 = D" and
    // poisons answer_key. Skip MS parsing entirely for PAT — the
    // solutions PDF still gets persisted (exams.ms_pdf_path) so a
    // future Gemini-based answer extractor can use it.
    const msUriToParse = args.testCode === 'PAT' ? null : args.msUri;
    const result = await extractor.extract({
      exam_id: args.examId,
      test_code: args.testCode,
      qp_uri: args.qpUri,
      ms_uri: msUriToParse,
      default_section: args.defaultSection,
      continuous_numbering: continuous,
      mcq_only: mcqOnly,
    });
    const inserted = await persistQuestions(
      args.examId,
      result.questions,
      result.answer_key,
    );
    await query(`UPDATE exams SET status = 'ready' WHERE id = $1`, [args.examId]);
    return { questions_inserted: inserted, warnings: result.warnings };
  } catch (err) {
    await query(`UPDATE exams SET status = 'error' WHERE id = $1`, [args.examId]);
    throw err;
  }
}

async function persistQuestions(
  examId: string,
  questions: ExtractedQuestion[],
  answerKey: Partial<Record<SectionCode, Record<string, AnswerKey>>>,
): Promise<number> {
  if (questions.length === 0) return 0;

  // Section id lookup table for this exam.
  const secs = await query<{ id: string; code: SectionCode }>(
    `SELECT id, code FROM sections WHERE exam_id = $1`,
    [examId],
  );
  const sectionId: Partial<Record<SectionCode, string>> = {};
  for (const r of secs.rows) sectionId[r.code] = r.id;

  // Wipe any prior questions for this exam — re-runs are idempotent.
  await query(
    `DELETE FROM questions WHERE section_id IN (SELECT id FROM sections WHERE exam_id = $1)`,
    [examId],
  );

  // Build a section-agnostic fallback by number for ENGAA / NSAA mark
  // schemes that don't print section headers (the parser dumps everything
  // under MATHS1 by default). The first-write wins on duplicate numbers,
  // which would only happen if a true ESAT MS bundles all sections.
  const fallbackByNumber = new Map<string, AnswerKey>();
  for (const sec of Object.values(answerKey)) {
    if (!sec) continue;
    for (const [n, a] of Object.entries(sec)) {
      if (!fallbackByNumber.has(n)) fallbackByNumber.set(n, a);
    }
  }

  let inserted = 0;
  const counts = new Map<SectionCode, number>();
  for (const q of questions) {
    const sid = sectionId[q.section_code];
    if (!sid) continue; // section wasn't pre-seeded for this test_code; skip.
    const ans =
      answerKey[q.section_code]?.[String(q.number)]
      ?? fallbackByNumber.get(String(q.number))
      ?? null;
    const markerBbox = q.marker_bbox
      ? JSON.stringify({ x: q.marker_bbox[0], y: q.marker_bbox[1], w: q.marker_bbox[2], h: q.marker_bbox[3] })
      : null;
    await query(
      `INSERT INTO questions (
         section_id, number, image_path, ocr_text, answer_key,
         question_type, page_index, bbox, marker_bbox
       )
       VALUES ($1, $2, $3, $4, $5, 'multiple_choice', $6, $7, $8)`,
      [
        sid,
        q.number,
        q.image_uri,
        q.ocr_text || null,
        ans,
        q.page_index,
        JSON.stringify({ x0: q.bbox[0], y0: q.bbox[1], x1: q.bbox[2], y1: q.bbox[3] }),
        markerBbox,
      ],
    );
    inserted += 1;
    counts.set(q.section_code, (counts.get(q.section_code) ?? 0) + 1);
  }

  // Update sections.question_count to match the inserted rows.
  for (const [code, n] of counts) {
    const sid = sectionId[code];
    if (sid) {
      await query(`UPDATE sections SET question_count = $1 WHERE id = $2`, [n, sid]);
    }
  }
  return inserted;
}

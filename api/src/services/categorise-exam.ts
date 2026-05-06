/**
 * Categorise every question on an exam in parallel, throttled by the
 * Gemini concurrency limiter. Persists topic_id, difficulty, summary,
 * keywords on each questions row.
 *
 * Idempotent: re-running on a fully-categorised exam re-writes the same
 * fields. Pass `onlyMissing=true` to skip questions that already have a
 * topic_id set (default), or false to force a full re-categorise.
 */

import type { SectionCode, TestCode } from '@esat/shared-types';
import { query } from '../db.js';
import { categoriseQuestion } from './categoriser.js';

export interface CategoriseSummary {
  total: number;
  categorised: number;
  skipped: number;
  failed: { question_id: string; error: string }[];
}

interface QuestionRow {
  id: string;
  number: number;
  image_path: string;
  ocr_text: string | null;
  topic_id: string | null;
  section_code: SectionCode;
  test_code: TestCode;
}

export async function categoriseExam(
  examId: string,
  opts: { onlyMissing?: boolean } = {},
): Promise<CategoriseSummary> {
  const onlyMissing = opts.onlyMissing ?? true;

  const rows = await query<QuestionRow>(
    `SELECT q.id, q.number, q.image_path, q.ocr_text, q.topic_id,
            s.code AS section_code, e.test_code
     FROM questions q
     JOIN sections s ON s.id = q.section_id
     JOIN exams e ON e.id = s.exam_id
     WHERE e.id = $1
     ORDER BY s.code, q.number`,
    [examId],
  );

  const todo = onlyMissing ? rows.rows.filter((r) => r.topic_id === null) : rows.rows;
  const summary: CategoriseSummary = {
    total: rows.rowCount ?? rows.rows.length,
    categorised: 0,
    skipped: (rows.rowCount ?? rows.rows.length) - todo.length,
    failed: [],
  };

  // Cache section -> topic.code -> topic.id once per run.
  const topicLookup = new Map<string, string>();
  const topicRows = await query<{ id: string; section_code: SectionCode; code: string }>(
    `SELECT id, section_code, code FROM topics`,
  );
  for (const t of topicRows.rows) topicLookup.set(`${t.section_code}:${t.code}`, t.id);

  // The Gemini wrapper itself throttles concurrent calls; we can fire
  // Promise.all over the full set without flooding the model.
  const results = await Promise.allSettled(
    todo.map(async (q) => {
      const out = await categoriseQuestion({
        testCode: q.test_code,
        sectionCode: q.section_code,
        questionNumber: q.number,
        imagePath: q.image_path,
        ocrText: q.ocr_text,
      });
      const topicId = out.topic_code
        ? topicLookup.get(`${q.section_code}:${out.topic_code}`) ?? null
        : null;
      await query(
        `UPDATE questions
         SET topic_id = $1,
             difficulty = $2,
             summary = $3,
             keywords = $4
         WHERE id = $5`,
        [topicId, out.difficulty, out.summary, out.keywords, q.id],
      );
      return { id: q.id };
    }),
  );

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (!r) continue;
    if (r.status === 'fulfilled') {
      summary.categorised += 1;
    } else {
      summary.failed.push({
        question_id: todo[i]!.id,
        error: String((r.reason as Error)?.message ?? r.reason),
      });
    }
  }
  return summary;
}

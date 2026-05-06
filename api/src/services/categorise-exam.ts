/**
 * Categorise every question on an exam in parallel, throttled by the
 * Gemini concurrency limiter. Persists topic_id, difficulty, summary,
 * keywords on each questions row, and re-routes the question's section_id
 * when the categoriser decides it belongs to a different section.
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
  /** Number of questions that were moved to a different section by the model. */
  rerouted: number;
  failed: { question_id: string; error: string }[];
}

interface QuestionRow {
  id: string;
  number: number;
  image_path: string;
  ocr_text: string | null;
  topic_id: string | null;
  section_id: string;
  section_code: SectionCode;
  exam_id: string;
  test_code: TestCode;
}

export async function categoriseExam(
  examId: string,
  opts: { onlyMissing?: boolean } = {},
): Promise<CategoriseSummary> {
  const onlyMissing = opts.onlyMissing ?? true;

  const rows = await query<QuestionRow>(
    `SELECT q.id, q.number, q.image_path, q.ocr_text, q.topic_id,
            s.id AS section_id, s.code AS section_code,
            e.id AS exam_id, e.test_code
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
    rerouted: 0,
    failed: [],
  };

  // Cache (section_code, topic.code) -> topic.id for the whole categorisation
  // run. Topics are seeded ahead of time so the table is small.
  const topicLookup = new Map<string, string>();
  const topicRows = await query<{ id: string; section_code: SectionCode; code: string }>(
    `SELECT id, section_code, code FROM topics`,
  );
  for (const t of topicRows.rows) topicLookup.set(`${t.section_code}:${t.code}`, t.id);

  // Cache (exam_id, section_code) -> sections.id so we can move a question
  // from one section to another when the categoriser disagrees with the
  // clipper. Limited to this exam's section rows.
  const sectionLookup = new Map<SectionCode, string>();
  const sectionRows = await query<{ id: string; code: SectionCode }>(
    `SELECT id, code FROM sections WHERE exam_id = $1`,
    [examId],
  );
  for (const s of sectionRows.rows) sectionLookup.set(s.code, s.id);

  // Track per-section counts for the question_count update at the end.
  const finalCounts = new Map<SectionCode, number>();
  for (const r of rows.rows) {
    // Initialise with the current placement; we'll move rows below.
    finalCounts.set(r.section_code, (finalCounts.get(r.section_code) ?? 0) + 1);
  }

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

      // Determine where the question should live.
      const targetSection = out.section_code;
      const targetSectionId = sectionLookup.get(targetSection);
      const sectionId = targetSectionId ?? q.section_id;
      const moved = !!targetSectionId && targetSectionId !== q.section_id;

      const topicId = out.topic_code
        ? topicLookup.get(`${targetSection}:${out.topic_code}`) ?? null
        : null;

      // The (section_id, number) UNIQUE constraint blocks moving Q5 from
      // PHYSICS into MATHS1 if MATHS1 already has a Q5. Skip the move and
      // keep the question in its clipped section in that case.
      let appliedSectionId = sectionId;
      if (moved) {
        const collision = await query(
          `SELECT 1 FROM questions
           WHERE section_id = $1 AND number = $2 AND id <> $3`,
          [targetSectionId, q.number, q.id],
        );
        if (collision.rowCount && collision.rowCount > 0) {
          appliedSectionId = q.section_id;
        }
      }

      await query(
        `UPDATE questions
         SET topic_id = $1,
             difficulty = $2,
             summary = $3,
             keywords = $4,
             section_id = $5
         WHERE id = $6`,
        [topicId, out.difficulty, out.summary, out.keywords, appliedSectionId, q.id],
      );

      return {
        id: q.id,
        moved: appliedSectionId !== q.section_id,
        from: q.section_code,
        to: appliedSectionId === q.section_id ? q.section_code : targetSection,
      };
    }),
  );

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (!r) continue;
    if (r.status === 'fulfilled') {
      summary.categorised += 1;
      if (r.value.moved) {
        summary.rerouted += 1;
        const from = r.value.from;
        const to = r.value.to;
        finalCounts.set(from, (finalCounts.get(from) ?? 0) - 1);
        finalCounts.set(to, (finalCounts.get(to) ?? 0) + 1);
      }
    } else {
      summary.failed.push({
        question_id: todo[i]!.id,
        error: String((r.reason as Error)?.message ?? r.reason),
      });
    }
  }

  // Sync sections.question_count with the post-categorise placement.
  for (const [code, n] of finalCounts) {
    const sid = sectionLookup.get(code);
    if (sid) {
      await query(`UPDATE sections SET question_count = $1 WHERE id = $2`, [Math.max(0, n), sid]);
    }
  }

  return summary;
}

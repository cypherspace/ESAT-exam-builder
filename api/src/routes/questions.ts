import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { categoriseQuestionById } from '../services/categorise-exam.js';

export const questions = Router();

const ListQuery = z.object({
  test_code: z.enum(['ENGAA', 'NSAA', 'PAT']).optional(),
  section: z
    .enum(['MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ADV_MATHS'])
    .optional(),
  topic_id: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  // Accepted but unused — difficulty is no longer a UI signal. Kept for
  // backwards-compat with any saved bookmarks / scripts.
  difficulty_min: z.coerce.number().int().min(1).max(5).optional(),
  difficulty_max: z.coerce.number().int().min(1).max(5).optional(),
  // 'true' restricts to topiced rows; 'false' restricts to topic_id IS NULL.
  // Omit for "any". String literal, since z.coerce.boolean() turns "false"
  // into true.
  categorised: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

questions.get('/', async (req, res, next) => {
  try {
    const filter = ListQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];

    const sql: string[] = [
      `SELECT q.id, q.section_id, q.number, q.image_path, q.ocr_text, q.answer_key,
              q.question_type, q.topic_id, q.difficulty, q.summary, q.keywords,
              s.code AS section_code, e.test_code, e.year, e.sitting
       FROM questions q
       JOIN sections s ON s.id = q.section_id
       JOIN exams e ON e.id = s.exam_id`,
    ];

    if (filter.test_code) {
      params.push(filter.test_code);
      where.push(`e.test_code = $${params.length}`);
    }
    if (filter.section) {
      params.push(filter.section);
      where.push(`s.code = $${params.length}`);
    }
    if (filter.topic_id) {
      params.push(filter.topic_id);
      where.push(`q.topic_id = $${params.length}`);
    }
    if (filter.year !== undefined) {
      params.push(filter.year);
      where.push(`e.year = $${params.length}`);
    }
    if (filter.difficulty_min !== undefined) {
      params.push(filter.difficulty_min);
      where.push(`q.difficulty >= $${params.length}`);
    }
    if (filter.difficulty_max !== undefined) {
      params.push(filter.difficulty_max);
      where.push(`q.difficulty <= $${params.length}`);
    }
    if (filter.categorised === 'true') where.push(`q.topic_id IS NOT NULL`);
    if (filter.categorised === 'false') where.push(`q.topic_id IS NULL`);
    if (where.length > 0) sql.push(`WHERE ${where.join(' AND ')}`);
    sql.push(`ORDER BY e.year DESC, e.sitting, s.code, q.number`);
    const limitIdx = params.push(filter.limit);
    const offsetIdx = params.push((filter.page - 1) * filter.limit);
    sql.push(`LIMIT $${limitIdx} OFFSET $${offsetIdx}`);

    const countSql = where.length === 0
      ? `SELECT COUNT(*)::text AS count FROM questions q
         JOIN sections s ON s.id = q.section_id
         JOIN exams e ON e.id = s.exam_id`
      : `SELECT COUNT(*)::text AS count FROM questions q
         JOIN sections s ON s.id = q.section_id
         JOIN exams e ON e.id = s.exam_id WHERE ${where.join(' AND ')}`;
    const countParams = params.slice(0, params.length - 2);

    const [rows, count] = await Promise.all([
      query(sql.join(' '), params),
      query<{ count: string }>(countSql, countParams),
    ]);

    res.json({
      data: rows.rows,
      meta: {
        page: filter.page,
        limit: filter.limit,
        total: Number(count.rows[0]?.count ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

questions.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT q.*, s.code AS section_code, e.test_code, e.year, e.sitting
       FROM questions q
       JOIN sections s ON s.id = q.section_id
       JOIN exams e ON e.id = s.exam_id
       WHERE q.id = $1`,
      [req.params.id],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'not_found', id: req.params.id });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// answer_key accepts the full A–Z range — Cambridge admissions papers
// have questions with up to 8 options (we've seen 'F', 'G', 'H'). The DB
// enum was widened in 1700000001000_widen_answer_key_enum.cjs.
const ANSWER_KEY_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') as [
  'A', ...string[],
];
const PatchBody = z.object({
  topic_id: z.string().uuid().nullable().optional(),
  difficulty: z.number().int().min(1).max(5).nullable().optional(),
  summary: z.string().max(400).nullable().optional(),
  keywords: z.array(z.string().max(40)).max(20).optional(),
  answer_key: z.enum(ANSWER_KEY_LETTERS).nullable().optional(),
});

questions.patch('/:id', async (req, res, next) => {
  try {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const key of [
      'topic_id', 'difficulty', 'summary', 'keywords', 'answer_key',
    ] as const) {
      if (parsed.data[key] !== undefined) {
        params.push(parsed.data[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'no_fields' });
      return;
    }
    params.push(req.params.id);
    const result = await query(
      `UPDATE questions SET ${fields.join(', ')} WHERE id = $${params.length}
       RETURNING id, section_id, number, image_path, ocr_text, answer_key,
                 question_type, topic_id, difficulty, summary, keywords`,
      params,
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Categorise a single question via Gemini. Used by the Library "Categorise"
// button on uncategorised cards.
questions.post('/:id/categorise', async (req, res, next) => {
  try {
    const out = await categoriseQuestionById(req.params.id);
    res.json(out);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    next(err);
  }
});

// Bulk-categorise every question with topic_id IS NULL that matches an
// optional filter shape (test_code / section). Caps the batch at 200 to
// keep one HTTP roundtrip from blowing the Gemini quota.
const BulkCategoriseBody = z.object({
  test_code: z.enum(['ENGAA', 'NSAA', 'PAT', 'ESAT']).optional(),
  section: z
    .enum(['MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ADV_MATHS'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
});
questions.post('/categorise-uncategorised', async (req, res, next) => {
  try {
    const parsed = BulkCategoriseBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const where: string[] = ['q.topic_id IS NULL'];
    const params: unknown[] = [];
    if (parsed.data.test_code) {
      params.push(parsed.data.test_code);
      where.push(`e.test_code = $${params.length}`);
    }
    if (parsed.data.section) {
      params.push(parsed.data.section);
      where.push(`s.code = $${params.length}`);
    }
    params.push(parsed.data.limit);
    const ids = await query<{ id: string }>(
      `SELECT q.id FROM questions q
       JOIN sections s ON s.id = q.section_id
       JOIN exams e ON e.id = s.exam_id
       WHERE ${where.join(' AND ')}
       LIMIT $${params.length}`,
      params,
    );

    let categorised = 0;
    let moved = 0;
    const failed: { question_id: string; error: string }[] = [];
    // Gemini wrapper throttles concurrency for us — fire all together.
    const results = await Promise.allSettled(
      ids.rows.map((r) => categoriseQuestionById(r.id)),
    );
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i]!;
      if (r.status === 'fulfilled') {
        categorised += 1;
        if (r.value.moved) moved += 1;
      } else {
        failed.push({
          question_id: ids.rows[i]!.id,
          error: String((r.reason as Error)?.message ?? r.reason),
        });
      }
    }
    res.json({ total: ids.rows.length, categorised, moved, failed });
  } catch (err) {
    next(err);
  }
});

const FlagBody = z.object({ note: z.string().min(1).max(2000) });

questions.post('/:id/flags', async (req, res, next) => {
  try {
    const parsed = FlagBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const userId =
      req.user?.id ??
      process.env.ADMIN_USER_UUID ??
      '00000000-0000-0000-0000-000000000001';
    const result = await query(
      `INSERT INTO flags (question_id, user_id, note)
       VALUES ($1, $2, $3)
       RETURNING id, question_id, user_id, note, status, created_at`,
      [req.params.id, userId, parsed.data.note],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

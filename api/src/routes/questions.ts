import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';

export const questions = Router();

const ListQuery = z.object({
  test_code: z.enum(['ESAT', 'ENGAA', 'NSAA']).optional(),
  section: z
    .enum(['MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ADV_MATHS'])
    .optional(),
  topic_id: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  difficulty_min: z.coerce.number().int().min(1).max(5).optional(),
  difficulty_max: z.coerce.number().int().min(1).max(5).optional(),
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

questions.patch('/:id', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 4 });
});

questions.post('/:id/flags', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 4 });
});

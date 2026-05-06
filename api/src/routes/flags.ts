import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';

export const flags = Router();

const CreateBody = z.object({
  question_id: z.string().uuid(),
  note: z.string().min(1).max(2000),
});

const PatchBody = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']),
});

import type { Request } from 'express';
function actorId(req: Request): string {
  return (
    req.user?.id ??
    process.env.ADMIN_USER_UUID ??
    '00000000-0000-0000-0000-000000000001'
  );
}

flags.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const sql = status
      ? `SELECT id, question_id, user_id, note, status, created_at
         FROM flags WHERE status = $1 ORDER BY created_at DESC`
      : `SELECT id, question_id, user_id, note, status, created_at
         FROM flags ORDER BY created_at DESC`;
    const rows = status
      ? await query(sql, [status])
      : await query(sql);
    res.json({ data: rows.rows });
  } catch (err) {
    next(err);
  }
});

flags.post('/', async (req, res, next) => {
  try {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const result = await query(
      `INSERT INTO flags (question_id, user_id, note)
       VALUES ($1, $2, $3)
       RETURNING id, question_id, user_id, note, status, created_at`,
      [parsed.data.question_id, actorId(req), parsed.data.note],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

flags.patch('/:id', async (req, res, next) => {
  try {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const result = await query(
      `UPDATE flags SET status = $1 WHERE id = $2
       RETURNING id, question_id, user_id, note, status, created_at`,
      [parsed.data.status, req.params.id],
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

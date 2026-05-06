import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';

export const drafts = Router();

const DraftItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('question'),
    question_id: z.string().uuid(),
    display_number: z.number().int().min(1).optional(),
  }),
  z.object({ type: z.literal('blank'), label: z.string().max(80).optional() }),
]);

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  items: z.array(DraftItem).default([]),
  time_limit_minutes: z.number().int().min(1).max(600).nullable().optional(),
  instructions: z.string().max(4000).nullable().optional(),
});

const PatchBody = CreateBody.partial();

interface DraftRow {
  id: string;
  owner_id: string;
  name: string;
  items: unknown;
  time_limit_minutes: number | null;
  instructions: string | null;
  created_at: string;
  updated_at: string;
}

import type { Request } from 'express';
function ownerId(req: Request): string {
  return (
    req.user?.id ??
    process.env.ADMIN_USER_UUID ??
    '00000000-0000-0000-0000-000000000001'
  );
}

drafts.get('/', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    const rows = await query<DraftRow>(
      `SELECT id, owner_id, name, items, time_limit_minutes, instructions,
              created_at, updated_at
       FROM paper_drafts WHERE owner_id = $1 ORDER BY updated_at DESC`,
      [owner],
    );
    res.json({ data: rows.rows });
  } catch (err) {
    next(err);
  }
});

drafts.post('/', async (req, res, next) => {
  try {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const owner = ownerId(req);
    const { name, items, time_limit_minutes, instructions } = parsed.data;
    const result = await query<DraftRow>(
      `INSERT INTO paper_drafts (owner_id, name, items, time_limit_minutes, instructions)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING id, owner_id, name, items, time_limit_minutes, instructions, created_at, updated_at`,
      [
        owner,
        name,
        JSON.stringify(items),
        time_limit_minutes ?? null,
        instructions ?? null,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

drafts.get('/:id', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    const row = await query<DraftRow>(
      `SELECT id, owner_id, name, items, time_limit_minutes, instructions,
              created_at, updated_at
       FROM paper_drafts WHERE id = $1 AND owner_id = $2`,
      [req.params.id, owner],
    );
    if (row.rowCount === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(row.rows[0]);
  } catch (err) {
    next(err);
  }
});

drafts.patch('/:id', async (req, res, next) => {
  try {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const owner = ownerId(req);
    const fields: string[] = [];
    const params: unknown[] = [];
    if (parsed.data.name !== undefined) {
      params.push(parsed.data.name);
      fields.push(`name = $${params.length}`);
    }
    if (parsed.data.items !== undefined) {
      params.push(JSON.stringify(parsed.data.items));
      fields.push(`items = $${params.length}::jsonb`);
    }
    if (parsed.data.time_limit_minutes !== undefined) {
      params.push(parsed.data.time_limit_minutes);
      fields.push(`time_limit_minutes = $${params.length}`);
    }
    if (parsed.data.instructions !== undefined) {
      params.push(parsed.data.instructions);
      fields.push(`instructions = $${params.length}`);
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'no_fields' });
      return;
    }
    fields.push(`updated_at = now()`);
    params.push(req.params.id);
    params.push(owner);
    const sql = `UPDATE paper_drafts SET ${fields.join(', ')}
                 WHERE id = $${params.length - 1} AND owner_id = $${params.length}
                 RETURNING id, owner_id, name, items, time_limit_minutes,
                           instructions, created_at, updated_at`;
    const result = await query<DraftRow>(sql, params);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

drafts.delete('/:id', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    const result = await query(
      `DELETE FROM paper_drafts WHERE id = $1 AND owner_id = $2`,
      [req.params.id, owner],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

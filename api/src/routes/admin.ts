/**
 * Admin user-management routes.
 *
 *   GET    /admin/users           — list every users + allowed_emails row
 *   POST   /admin/invites         — { email, role } → add to allowed_emails
 *   DELETE /admin/invites/:email  — pull a pending invite
 *   PATCH  /admin/users/:id       — { role } change a signed-in user's role
 *   DELETE /admin/users/:id       — revoke an existing user (deletes the row)
 *
 * All routes require role='admin' (enforced by requireRole below).
 */

import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireRole, userIdOrDev } from '../middleware/auth.js';

export const admin = Router();

const RoleEnum = z.enum(['admin', 'teacher', 'student']);

admin.get('/users', requireRole('admin'), async (_req, res, next) => {
  try {
    const users = await query(
      `SELECT id, email, display_name, role, created_at, last_login_at
       FROM users ORDER BY email`,
    );
    const invites = await query(
      `SELECT a.email, a.role, a.created_at, u.email AS added_by_email
       FROM allowed_emails a
       LEFT JOIN users u ON u.id = a.added_by
       ORDER BY a.email`,
    );
    res.json({ users: users.rows, invites: invites.rows });
  } catch (err) {
    next(err);
  }
});

const InviteBody = z.object({
  email: z.string().email().max(254),
  role: RoleEnum.default('teacher'),
});

admin.post('/invites', requireRole('admin'), async (req, res, next) => {
  try {
    const parsed = InviteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const email = parsed.data.email.toLowerCase();

    // If the email is already a signed-in user, reject — admins should
    // use PATCH /admin/users/:id to change an existing user's role.
    const existing = await query(
      `SELECT 1 FROM users WHERE LOWER(email) = $1`,
      [email],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      res.status(409).json({ error: 'already_user' });
      return;
    }

    await query(
      `INSERT INTO allowed_emails (email, role, added_by)
       VALUES ($1, $2::user_role, $3)
       ON CONFLICT ((LOWER(email))) DO UPDATE SET role = EXCLUDED.role`,
      [email, parsed.data.role, userIdOrDev(req)],
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

admin.delete('/invites/:email', requireRole('admin'), async (req, res, next) => {
  try {
    const email = (req.params.email ?? '').toLowerCase();
    const r = await query(
      `DELETE FROM allowed_emails WHERE LOWER(email) = $1`,
      [email],
    );
    if (!r.rowCount) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const PatchUserBody = z.object({ role: RoleEnum });

admin.patch('/users/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const parsed = PatchUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const r = await query(
      `UPDATE users SET role = $1::user_role WHERE id = $2
       RETURNING id, email, role`,
      [parsed.data.role, req.params.id],
    );
    if (!r.rowCount) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

admin.delete('/users/:id', requireRole('admin'), async (req, res, next) => {
  try {
    // Don't let an admin delete their own row — they'd lock themselves
    // out of the only path back into the app.
    if (req.params.id === userIdOrDev(req)) {
      res.status(400).json({ error: 'cannot_delete_self' });
      return;
    }
    const r = await query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

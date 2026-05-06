import { randomBytes } from 'node:crypto';
import { query } from '../db.js';

const SESSION_TTL_DAYS = 7;

export interface SessionUser {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'teacher' | 'student';
}

export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export async function createSession(userId: string): Promise<string> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt],
  );
  return token;
}

export async function loadSessionUser(token: string): Promise<SessionUser | null> {
  if (!token) return null;
  const result = await query<SessionUser>(
    `SELECT u.id, u.email, u.display_name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

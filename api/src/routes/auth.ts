/**
 * Google OAuth + opaque session tokens.
 *
 * Flow:
 *   GET  /auth/google/start    -> redirect to Google with HMAC-signed state
 *   GET  /auth/google/callback -> verify state + id_token, upsert user,
 *                                 create session, set cookie, redirect to
 *                                 frontend.
 *   GET  /auth/me              -> session-or-dev user.
 *   POST /auth/logout          -> destroy session + clear cookie.
 *
 * Uses HMAC-signed state (not a cookie) so multi-tab logins don't clobber
 * each other. ALLOWED_EMAILS env (comma-separated) gates new-user signup
 * when present; existing users are always allowed in.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { request as undiciRequest } from 'undici';
import { query } from '../db.js';
import {
  SID_COOKIE,
  clearCookie,
  readCookie,
  setCookie,
} from '../middleware/auth.js';
import {
  createSession,
  destroySession,
  loadSessionUser,
} from '../services/sessions.js';

export const auth = Router();

const STATE_TTL_MS = 10 * 60 * 1000;

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';

function publicUrl(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${proto}://${host}`;
}

function frontendUrl(req: Request): string {
  return process.env.FRONTEND_URL || publicUrl(req);
}

function signState(): string {
  const ts = Date.now().toString(36);
  const nonce = randomBytes(12).toString('hex');
  const payload = `${ts}.${nonce}`;
  const sig = createHmac('sha256', clientSecret || 'unset')
    .update(payload)
    .digest('hex')
    .slice(0, 24);
  return `${payload}.${sig}`;
}

function verifyState(state: string): boolean {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  if (!ts || !nonce || !sig) return false;
  const age = Date.now() - parseInt(ts, 36);
  if (!Number.isFinite(age) || age < 0 || age > STATE_TTL_MS) return false;
  const expected = createHmac('sha256', clientSecret || 'unset')
    .update(`${ts}.${nonce}`)
    .digest('hex')
    .slice(0, 24);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function allowedEmails(): Set<string> | null {
  const raw = process.env.ALLOWED_EMAILS;
  if (!raw) return null;
  const set = new Set(
    raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  return set.size === 0 ? null : set;
}

auth.get('/google/start', (req, res) => {
  if (!clientId) {
    res.status(500).json({ error: 'oauth_not_configured' });
    return;
  }
  const state = signState();
  const redirectUri = `${publicUrl(req)}/api/v1/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

auth.get('/google/callback', async (req, res, next) => {
  const bounce = (errorCode: string, extra?: Record<string, string>) => {
    const params = new URLSearchParams({ error: errorCode, ...(extra ?? {}) });
    res.redirect(`${frontendUrl(req)}/login?${params.toString()}`);
  };
  try {
    if (typeof req.query.error === 'string' && req.query.error.trim()) {
      bounce('google_error', { detail: String(req.query.error) });
      return;
    }
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    if (!code || !state) {
      bounce('missing_params');
      return;
    }
    if (!verifyState(state)) {
      bounce('stale_state');
      return;
    }

    const redirectUri = `${publicUrl(req)}/api/v1/auth/google/callback`;
    const tokenRes = await undiciRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (tokenRes.statusCode >= 400) {
      bounce('oauth_failed');
      return;
    }
    const tokens = (await tokenRes.body.json()) as {
      id_token?: string;
      access_token?: string;
    };
    if (!tokens.id_token) {
      bounce('oauth_failed');
      return;
    }

    const verifyRes = await undiciRequest(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`,
    );
    if (verifyRes.statusCode >= 400) {
      bounce('oauth_failed');
      return;
    }
    const claims = (await verifyRes.body.json()) as {
      sub: string;
      email?: string;
      email_verified?: string | boolean;
      name?: string;
      aud?: string;
    };
    if (claims.aud !== clientId) {
      bounce('oauth_failed');
      return;
    }
    const verified =
      claims.email_verified === true || claims.email_verified === 'true';
    if (!claims.email || !verified) {
      bounce('unverified_email');
      return;
    }

    const email = claims.email.toLowerCase();
    const existing = await query<{
      id: string;
      role: 'admin' | 'teacher' | 'student';
    }>(`SELECT id, role FROM users WHERE email = $1`, [email]);

    let userId: string;
    if (existing.rowCount && existing.rows[0]) {
      userId = existing.rows[0].id;
      await query(
        `UPDATE users SET google_id = COALESCE(google_id, $1),
                          display_name = COALESCE(display_name, $2),
                          last_login_at = now()
         WHERE id = $3`,
        [claims.sub, claims.name ?? null, userId],
      );
    } else {
      const allow = allowedEmails();
      if (allow && !allow.has(email)) {
        bounce('not_allowed', { email });
        return;
      }
      const created = await query<{ id: string }>(
        `INSERT INTO users (google_id, email, display_name, role, last_login_at)
         VALUES ($1, $2, $3, 'teacher', now())
         RETURNING id`,
        [claims.sub, email, claims.name ?? null],
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error('user insert returned no id');
      userId = id;
    }

    const sid = await createSession(userId);
    setCookie(res, SID_COOKIE, sid, { maxAge: 7 * 24 * 60 * 60 });
    res.redirect(frontendUrl(req));
  } catch (err) {
    next(err);
  }
});

auth.get('/me', async (req, res) => {
  if (process.env.AUTH_DISABLED === 'true') {
    res.json({
      id:
        process.env.ADMIN_USER_UUID ??
        '00000000-0000-0000-0000-000000000001',
      email: 'dev@local',
      role: 'admin',
    });
    return;
  }
  const token = readCookie(req, SID_COOKIE);
  const user = token ? await loadSessionUser(token) : null;
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  res.json(user);
});

auth.post('/logout', async (req, res) => {
  const token = readCookie(req, SID_COOKIE);
  if (token) await destroySession(token);
  clearCookie(res, SID_COOKIE);
  res.json({ ok: true });
});

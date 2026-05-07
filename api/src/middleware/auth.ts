import type { NextFunction, Request, Response } from 'express';
import { loadSessionUser, type SessionUser } from '../services/sessions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export const SID_COOKIE = 'esat_sid';

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setCookie(
  res: Response,
  name: string,
  value: string,
  opts: { maxAge?: number; secure?: boolean } = {},
): void {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push('Path=/');
  // Production: frontend and API live on different *.run.app subdomains,
  // so the session cookie has to be SameSite=None (with Secure) to ride
  // cross-origin fetch requests. Local dev (no Secure) keeps SameSite=Lax
  // since browsers reject SameSite=None over plain HTTP.
  const secure = opts.secure ?? process.env.COOKIE_SECURE === 'true';
  parts.push(secure ? 'SameSite=None' : 'SameSite=Lax');
  parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  const existing = res.getHeader('Set-Cookie');
  const out = Array.isArray(existing)
    ? [...existing, parts.join('; ')]
    : existing
    ? [String(existing), parts.join('; ')]
    : parts.join('; ');
  res.setHeader('Set-Cookie', out);
}

export function clearCookie(res: Response, name: string): void {
  setCookie(res, name, '', { maxAge: 0 });
}

const adminUserId =
  process.env.ADMIN_USER_UUID ?? '00000000-0000-0000-0000-000000000001';

function devUser(): SessionUser {
  return {
    id: adminUserId,
    email: 'dev@local',
    display_name: 'Dev admin',
    role: 'admin',
  };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (process.env.AUTH_DISABLED === 'true') {
    req.user = devUser();
    next();
    return;
  }

  // Bulk-ingest scripts can present a shared secret in X-Ingest-Key.
  const ingestKey = req.get('x-ingest-key');
  if (process.env.INGEST_API_KEY && ingestKey === process.env.INGEST_API_KEY) {
    req.user = devUser();
    next();
    return;
  }

  const token = readCookie(req, SID_COOKIE);
  const user = token ? await loadSessionUser(token) : null;
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  req.user = user;
  next();
}

export function requireRole(...roles: SessionUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

/** Resolve a user id, honouring AUTH_DISABLED dev mode. */
export function userIdOrDev(req: Request): string {
  return req.user?.id ?? adminUserId;
}

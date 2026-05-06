import { Router } from 'express';

export const auth = Router();

auth.get('/me', (_req, res) => {
  if (process.env.AUTH_DISABLED === 'true') {
    res.json({
      id: process.env.ADMIN_USER_UUID ?? '00000000-0000-0000-0000-000000000001',
      email: 'dev@local',
      role: 'admin',
    });
    return;
  }
  res.status(401).json({ error: 'unauthenticated' });
});

auth.get('/google/start', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 6 });
});

auth.get('/google/callback', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 6 });
});

auth.post('/logout', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 6 });
});

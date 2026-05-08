import './bootstrap.js';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { exams } from './routes/exams.js';
import { questions } from './routes/questions.js';
import { topics } from './routes/topics.js';
import { drafts } from './routes/drafts.js';
import { generate } from './routes/generate.js';
import { exportRouter } from './routes/export.js';
import { flags } from './routes/flags.js';
import { auth } from './routes/auth.js';
import { admin } from './routes/admin.js';
import { files } from './routes/files.js';

const app = express();
const port = Number(process.env.PORT ?? 8082);

// CORS: allow the configured FRONTEND_URL plus any localhost dev port
// (Vite hops 5173 → 5174 → … when earlier ports are taken). In production
// pin via FRONTEND_URL only.
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allow = process.env.FRONTEND_URL;
      if (allow && origin === allow) return cb(null, true);
      if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error(`CORS: ${origin} not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

import { requireAuth } from './middleware/auth.js';

app.use('/api/v1/auth', auth);

// Authenticated APIs. /healthz and the OAuth start/callback stay open.
app.use('/api/v1/exams', requireAuth, exams);
app.use('/api/v1/questions', requireAuth, questions);
app.use('/api/v1/topics', requireAuth, topics);
app.use('/api/v1/drafts', requireAuth, drafts);
app.use('/api/v1/generate', requireAuth, generate);
app.use('/api/v1/export', requireAuth, exportRouter);
app.use('/api/v1/flags', requireAuth, flags);
app.use('/api/v1/admin', requireAuth, admin);
app.use('/files', requireAuth, files);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[esat-api] error', err);
  const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
  res.status(status).json({ error: 'internal_error', message: String(err?.message ?? err) });
};
app.use(errorHandler);

app.listen(port, () => {
  console.log(`[esat-api] listening on :${port}`);
});

import 'dotenv/config';
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
import { files } from './routes/files.js';

const app = express();
const port = Number(process.env.PORT ?? 8082);

app.use(cors({ origin: process.env.VITE_API_URL ?? true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/api/v1/auth', auth);
app.use('/api/v1/exams', exams);
app.use('/api/v1/questions', questions);
app.use('/api/v1/topics', topics);
app.use('/api/v1/drafts', drafts);
app.use('/api/v1/generate', generate);
app.use('/api/v1/export', exportRouter);
app.use('/api/v1/flags', flags);
app.use('/files', files);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[esat-api] error', err);
  const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
  res.status(status).json({ error: 'internal_error', message: String(err?.message ?? err) });
};
app.use(errorHandler);

app.listen(port, () => {
  console.log(`[esat-api] listening on :${port}`);
});

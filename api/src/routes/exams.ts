import { Router } from 'express';

export const exams = Router();

exams.get('/', (_req, res) => {
  res.json({ data: [], meta: { page: 1, limit: 50, total: 0 } });
});

exams.post('/upload', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 1 });
});

exams.get('/:id', (req, res) => {
  res.status(404).json({ error: 'not_found', id: req.params.id });
});

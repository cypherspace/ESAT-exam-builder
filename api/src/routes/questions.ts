import { Router } from 'express';

export const questions = Router();

questions.get('/', (_req, res) => {
  res.json({ data: [], meta: { page: 1, limit: 50, total: 0 } });
});

questions.get('/:id', (req, res) => {
  res.status(404).json({ error: 'not_found', id: req.params.id });
});

questions.patch('/:id', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 1 });
});

questions.post('/:id/flags', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 4 });
});

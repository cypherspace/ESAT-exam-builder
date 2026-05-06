import { Router } from 'express';

export const flags = Router();

flags.get('/', (_req, res) => {
  res.json({ data: [] });
});

flags.patch('/:id', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 4 });
});

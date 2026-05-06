import { Router } from 'express';

export const drafts = Router();

drafts.get('/', (_req, res) => {
  res.json({ data: [] });
});

drafts.post('/', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 4 });
});

drafts.get('/:id', (req, res) => {
  res.status(404).json({ error: 'not_found', id: req.params.id });
});

drafts.patch('/:id', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 4 });
});

drafts.delete('/:id', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 4 });
});

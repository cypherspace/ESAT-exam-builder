import { Router } from 'express';

export const generate = Router();

generate.post('/', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 5 });
});

import { Router } from 'express';

export const exportRouter = Router();

exportRouter.post('/draft/:id', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 5 });
});

import { Router } from 'express';

export const topics = Router();

topics.get('/', (_req, res) => {
  res.json({ data: [] });
});

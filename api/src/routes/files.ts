import { Router } from 'express';

export const files = Router();

// GET /files?u=<storage-uri>&stream=0|1
// Resolves a storage URI (local path or gs://) to bytes.
files.get('/', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', phase: 1 });
});

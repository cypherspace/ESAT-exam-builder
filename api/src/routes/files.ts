import { Router } from 'express';
import { resolve } from 'node:path';
import { statSize, streamLocal } from '../storage.js';

export const files = Router();

const localRoot = resolve(process.env.STORAGE_DIR ?? './storage');

// GET /files?u=<storage-uri>
// Phase 1 only serves local file:// URIs. GCS streams via signed URLs in Phase 6.
files.get('/', async (req, res, next) => {
  try {
    const uri = String(req.query.u ?? '');
    if (!uri) {
      res.status(400).json({ error: 'u_required' });
      return;
    }
    if (!uri.startsWith('file://')) {
      res.status(400).json({ error: 'unsupported_uri_scheme' });
      return;
    }
    const path = uri.slice('file://'.length);
    if (!path.startsWith(localRoot)) {
      res.status(403).json({ error: 'outside_storage_root' });
      return;
    }
    const size = await statSize(uri);
    const ext = path.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'pdf' ? 'application/pdf' :
      ext === 'png' ? 'image/png' :
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      'application/octet-stream';
    res.setHeader('content-type', mime);
    res.setHeader('content-length', String(size));
    streamLocal(uri).pipe(res);
  } catch (err) {
    next(err);
  }
});

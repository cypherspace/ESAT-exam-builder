import { Router } from 'express';
import { resolve } from 'node:path';
import { statSize, streamUri } from '../storage.js';

export const files = Router();

const localRoot = resolve(process.env.STORAGE_DIR ?? './storage');
const gcsBucket = process.env.STORAGE_BUCKET;

// GET /files?u=<storage-uri>
// Serves both file:// URIs (local dev) and gs:// URIs (Cloud Run + GCS).
files.get('/', async (req, res, next) => {
  try {
    const uri = String(req.query.u ?? '');
    if (!uri) {
      res.status(400).json({ error: 'u_required' });
      return;
    }

    let mimeKey = '';
    if (uri.startsWith('file://')) {
      const path = uri.slice('file://'.length);
      if (!path.startsWith(localRoot)) {
        res.status(403).json({ error: 'outside_storage_root' });
        return;
      }
      mimeKey = path;
    } else if (uri.startsWith('gs://')) {
      const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
      if (!m) {
        res.status(400).json({ error: 'bad_gs_uri' });
        return;
      }
      if (gcsBucket && m[1] !== gcsBucket) {
        res.status(403).json({ error: 'foreign_bucket' });
        return;
      }
      mimeKey = m[2]!;
    } else {
      res.status(400).json({ error: 'unsupported_uri_scheme' });
      return;
    }

    const ext = mimeKey.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'pdf' ? 'application/pdf' :
      ext === 'png' ? 'image/png' :
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      'application/octet-stream';
    res.setHeader('content-type', mime);

    // PDFs are export artefacts — push them as downloads so opening one
    // in a new tab from the Builder / Drafts page actually saves the
    // file. PNGs / images stay inline so they can render in <img> tags.
    if (ext === 'pdf') {
      const basename = mimeKey.split(/[\\/]/).pop() ?? 'export.pdf';
      res.setHeader(
        'content-disposition',
        `attachment; filename="${basename.replace(/"/g, '')}"`,
      );
    }

    // For file:// we know the size up-front; for gs:// we let the stream
    // body length flow through (transfer-encoding: chunked).
    if (uri.startsWith('file://')) {
      res.setHeader('content-length', String(await statSize(uri)));
    }

    streamUri(uri).pipe(res);
  } catch (err) {
    next(err);
  }
});

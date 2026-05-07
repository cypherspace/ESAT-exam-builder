/**
 * One-shot script: re-run the extractor's detect_markers() against every
 * exam's source PDF and fill in `questions.marker_bbox` for any row that
 * has it null.
 *
 * Usage:
 *   tsx infra/db/scripts/backfill_marker_bbox.ts
 *
 * Reads DATABASE_URL + EXTRACTOR_URL from the project-root .env. The
 * extractor must be running locally (or the script needs the URL of a
 * deployed extractor that the SA can reach).
 *
 * The extractor's /extract endpoint already returns marker_bbox for every
 * question alongside its image_uri, so we just call it per exam, match
 * back by (section_code, number), and update.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { request as undiciRequest } from 'undici';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

const DATABASE_URL = process.env.DATABASE_URL!;
const EXTRACTOR_URL = process.env.EXTRACTOR_URL ?? 'http://localhost:8081';

interface Exam {
  id: string;
  test_code: string;
  source_pdf_path: string;
}

interface ExtractorQuestion {
  section_code: string;
  number: number;
  marker_bbox: [number, number, number, number] | null;
}

async function callExtract(exam: Exam): Promise<ExtractorQuestion[]> {
  const continuous =
    exam.test_code === 'ENGAA' ||
    exam.test_code === 'NSAA' ||
    exam.test_code === 'PAT';
  const res = await undiciRequest(`${EXTRACTOR_URL}/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      exam_id: exam.id,
      test_code: exam.test_code,
      qp_uri: exam.source_pdf_path,
      ms_uri: null,
      default_section: 'MATHS1',
      continuous_numbering: continuous,
    }),
    headersTimeout: 600_000,
    bodyTimeout: 600_000,
  });
  const text = await res.body.text();
  if (res.statusCode >= 400) {
    throw new Error(`extractor ${exam.id}: ${res.statusCode} ${text}`);
  }
  const body = JSON.parse(text) as { questions: ExtractorQuestion[] };
  return body.questions;
}

async function main() {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const exams = await client.query<Exam>(
    `SELECT id, test_code, source_pdf_path FROM exams WHERE status = 'ready'`,
  );
  console.log(`[backfill] ${exams.rows.length} exams to process`);

  let totalUpdated = 0;
  for (const exam of exams.rows) {
    const remaining = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM questions q
       JOIN sections s ON s.id = q.section_id
       WHERE s.exam_id = $1 AND q.marker_bbox IS NULL`,
      [exam.id],
    );
    if (Number(remaining.rows[0]!.count) === 0) {
      console.log(`[backfill] ${exam.id} already populated, skipping`);
      continue;
    }
    let extracted: ExtractorQuestion[];
    try {
      extracted = await callExtract(exam);
    } catch (err) {
      console.error(`[backfill] ${exam.id} failed:`, err);
      continue;
    }
    let n = 0;
    for (const eq of extracted) {
      if (!eq.marker_bbox) continue;
      const [x, y, w, h] = eq.marker_bbox;
      // Match by (exam_id, number) — for ENGAA / NSAA / PAT the question
      // number is continuous across the whole paper, so it identifies the
      // question even after the categoriser has rerouted it to a
      // different section. ESAT (per-section restart) isn't in the
      // current dataset.
      const r = await client.query(
        `UPDATE questions q
         SET marker_bbox = $1::jsonb
         FROM sections s
         WHERE q.section_id = s.id
           AND s.exam_id = $2
           AND q.number = $3
           AND q.marker_bbox IS NULL`,
        [JSON.stringify({ x, y, w, h }), exam.id, eq.number],
      );
      n += r.rowCount ?? 0;
    }
    console.log(`[backfill] ${exam.id} (${exam.test_code}) updated ${n}`);
    totalUpdated += n;
  }

  await client.end();
  console.log(`[backfill] done — ${totalUpdated} rows updated`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

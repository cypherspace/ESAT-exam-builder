import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { TestCode } from '@esat/shared-types';
import { query } from '../db.js';
import { writeBytes } from '../storage.js';
import { ingestExam } from '../services/ingest.js';
import { SECTIONS_BY_TEST } from '../sections.js';

export const exams = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 2 },
});

const UploadBody = z.object({
  test_code: z.enum(['ESAT', 'ENGAA', 'NSAA']),
  year: z.coerce.number().int().min(2000).max(2100),
  sitting: z.string().min(1).max(40),
  default_section: z
    .enum(['MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ADV_MATHS'])
    .optional(),
});

interface ExamRow {
  id: string;
  test_code: TestCode;
  year: number;
  sitting: string;
  source_pdf_path: string;
  ms_pdf_path: string | null;
  status: 'pending' | 'extracting' | 'ready' | 'error';
  uploaded_at: string;
}

exams.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const offset = (page - 1) * limit;
    const [list, count] = await Promise.all([
      query<ExamRow>(
        `SELECT id, test_code, year, sitting, source_pdf_path, ms_pdf_path, status, uploaded_at
         FROM exams ORDER BY uploaded_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM exams'),
    ]);
    res.json({
      data: list.rows,
      meta: { page, limit, total: Number(count.rows[0]?.count ?? 0) },
    });
  } catch (err) {
    next(err);
  }
});

exams.get('/:id', async (req, res, next) => {
  try {
    const exam = await query<ExamRow>(
      `SELECT id, test_code, year, sitting, source_pdf_path, ms_pdf_path, status, uploaded_at
       FROM exams WHERE id = $1`,
      [req.params.id],
    );
    if (exam.rowCount === 0) {
      res.status(404).json({ error: 'not_found', id: req.params.id });
      return;
    }
    const sections = await query(
      `SELECT id, code, question_count FROM sections WHERE exam_id = $1 ORDER BY code`,
      [req.params.id],
    );
    res.json({ ...exam.rows[0], sections: sections.rows });
  } catch (err) {
    next(err);
  }
});

exams.post(
  '/upload',
  upload.fields([
    { name: 'qp', maxCount: 1 },
    { name: 'ms', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const parsed = UploadBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
        return;
      }
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const qp = files?.qp?.[0];
      const ms = files?.ms?.[0];
      if (!qp) {
        res.status(400).json({ error: 'qp_pdf_required' });
        return;
      }

      const { test_code, year, sitting, default_section } = parsed.data;
      const slug = `${test_code}/${year}/${sitting}`.toLowerCase().replace(/\s+/g, '_');
      const qpUri = await writeBytes(`exams/${slug}/qp.pdf`, qp.buffer);
      const msUri = ms ? await writeBytes(`exams/${slug}/ms.pdf`, ms.buffer) : null;

      const inserted = await query<ExamRow>(
        `INSERT INTO exams (test_code, year, sitting, source_pdf_path, ms_pdf_path, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (test_code, year, sitting)
         DO UPDATE SET source_pdf_path = EXCLUDED.source_pdf_path,
                       ms_pdf_path = EXCLUDED.ms_pdf_path,
                       status = 'pending'
         RETURNING id, test_code, year, sitting, source_pdf_path, ms_pdf_path, status, uploaded_at`,
        [test_code, year, sitting, qpUri, msUri],
      );
      const exam = inserted.rows[0];
      if (!exam) throw new Error('insert returned no row');

      for (const code of SECTIONS_BY_TEST[test_code]) {
        await query(
          `INSERT INTO sections (exam_id, code, question_count)
           VALUES ($1, $2, 0)
           ON CONFLICT (exam_id, code) DO NOTHING`,
          [exam.id, code],
        );
      }

      // Fire-and-forget: full extract pipeline (clip + answer-key parse +
      // persist questions). Status moves through 'extracting' -> 'ready' /
      // 'error'. Clients poll GET /exams/:id to watch.
      ingestExam({
        examId: exam.id,
        testCode: test_code,
        qpUri,
        msUri,
        defaultSection: default_section,
      }).catch((err: unknown) => {
        console.error(`[exams.upload] ingest failed for ${exam.id}:`, err);
      });

      res.status(201).json(exam);
    } catch (err) {
      next(err);
    }
  },
);

// Retry/rerun the extract pipeline for an exam that's already had its PDFs
// uploaded. Useful when heuristics get tuned and we want to re-clip without
// re-uploading the PDFs.
exams.post('/:id/extract', async (req, res, next) => {
  try {
    const exam = await query<ExamRow>(
      `SELECT id, test_code, source_pdf_path, ms_pdf_path FROM exams WHERE id = $1`,
      [req.params.id],
    );
    const row = exam.rows[0];
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const out = await ingestExam({
      examId: row.id,
      testCode: row.test_code,
      qpUri: row.source_pdf_path,
      msUri: row.ms_pdf_path,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';

export const topics = Router();

const SectionFilter = z.enum([
  'MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ADV_MATHS',
]);

topics.get('/', async (req, res, next) => {
  try {
    const section = req.query.section
      ? SectionFilter.parse(req.query.section)
      : null;
    const result = section
      ? await query(
          `SELECT id, section_code, code, name FROM topics
           WHERE section_code = $1 ORDER BY code`,
          [section],
        )
      : await query(
          `SELECT id, section_code, code, name FROM topics ORDER BY section_code, code`,
        );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

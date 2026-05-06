import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { generatePaper } from '../services/generator.js';

export const generate = Router();

const SectionEnum = z.enum([
  'MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ADV_MATHS',
]);

const Bucket = z.object({
  count: z.number().int().min(1).max(200),
  topics: z.array(z.string()).optional(),
  difficulty_range: z
    .tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)])
    .optional(),
});

const Body = z.object({
  name: z.string().min(1).max(200).optional(),
  test_code: z.enum(['ESAT', 'ENGAA', 'NSAA']),
  section_mix: z.record(SectionEnum, Bucket),
  avoid_duplicate_topics: z.boolean().optional(),
  /** When true, also create a paper_drafts row with the generated items. */
  save_as_draft: z.boolean().optional(),
});

generate.post('/', async (req, res, next) => {
  try {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', issues: parsed.error.issues });
      return;
    }
    const out = await generatePaper({
      test_code: parsed.data.test_code,
      // zod widens difficulty_range to [number, number]; the schema's
      // 1..5 .int().min().max() range guarantees we satisfy Difficulty.
      section_mix: parsed.data.section_mix as Parameters<typeof generatePaper>[0]['section_mix'],
      avoid_duplicate_topics: parsed.data.avoid_duplicate_topics,
    });

    if (parsed.data.save_as_draft && out.question_ids.length > 0) {
      const owner = process.env.ADMIN_USER_UUID ?? '00000000-0000-0000-0000-000000000001';
      const items = out.question_ids.map((qid) => ({
        type: 'question' as const,
        question_id: qid,
      }));
      const draft = await query<{ id: string }>(
        `INSERT INTO paper_drafts (owner_id, name, items, time_limit_minutes, instructions)
         VALUES ($1, $2, $3::jsonb, NULL, NULL)
         RETURNING id`,
        [
          owner,
          parsed.data.name ?? `Generated ${parsed.data.test_code} paper`,
          JSON.stringify(items),
        ],
      );
      res.json({ ...out, draft_id: draft.rows[0]?.id ?? null });
      return;
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

/**
 * Random paper generator.
 *
 * Given a section_mix spec ({ MATHS1: { count: 10, topics?: [...], difficulty_range?: [1,3] } })
 * pick `count` distinct questions per section that satisfy the constraints,
 * optionally avoiding duplicate topics within a section.
 *
 * Returns the chosen question_ids in the section_mix order. The caller is
 * responsible for creating the draft row.
 */

import type {
  Difficulty,
  GenerateRequest,
  SectionCode,
  TestCode,
} from '@esat/shared-types';
import { query } from '../db.js';

export interface GenerateResult {
  question_ids: string[];
  by_section: { section: SectionCode; picked: number; requested: number }[];
  unfilled: { section: SectionCode; reason: string }[];
}

interface CandidateRow {
  id: string;
  topic_id: string | null;
  section_code: SectionCode;
}

export async function generatePaper(req: GenerateRequest): Promise<GenerateResult> {
  const result: GenerateResult = {
    question_ids: [],
    by_section: [],
    unfilled: [],
  };

  for (const [section, spec] of Object.entries(req.section_mix) as [
    SectionCode,
    NonNullable<GenerateRequest['section_mix'][SectionCode]>,
  ][]) {
    if (!spec || spec.count <= 0) continue;

    const candidates = await fetchCandidates(req.test_code, section, spec);
    const chosen = pick(
      candidates,
      spec.count,
      req.avoid_duplicate_topics ?? true,
    );
    result.question_ids.push(...chosen.map((c) => c.id));
    result.by_section.push({
      section,
      requested: spec.count,
      picked: chosen.length,
    });
    if (chosen.length < spec.count) {
      result.unfilled.push({
        section,
        reason: `only ${chosen.length}/${spec.count} candidates matched the constraints`,
      });
    }
  }

  return result;
}

async function fetchCandidates(
  testCode: TestCode,
  section: SectionCode,
  spec: NonNullable<GenerateRequest['section_mix'][SectionCode]>,
): Promise<CandidateRow[]> {
  const params: unknown[] = [testCode, section];
  let sql = `SELECT q.id, q.topic_id, s.code AS section_code
             FROM questions q
             JOIN sections s ON s.id = q.section_id
             JOIN exams e ON e.id = s.exam_id
             WHERE e.test_code = $1 AND s.code = $2`;

  if (spec.topics && spec.topics.length > 0) {
    params.push(spec.topics);
    sql += ` AND EXISTS (
               SELECT 1 FROM topics t
               WHERE t.id = q.topic_id
                 AND t.section_code = s.code
                 AND t.code = ANY($${params.length}::text[])
             )`;
  }
  if (spec.difficulty_range) {
    const [lo, hi] = spec.difficulty_range as [Difficulty, Difficulty];
    params.push(lo);
    sql += ` AND q.difficulty >= $${params.length}`;
    params.push(hi);
    sql += ` AND q.difficulty <= $${params.length}`;
  }

  const rows = await query<CandidateRow>(sql, params);
  return rows.rows;
}

function pick(
  candidates: CandidateRow[],
  n: number,
  avoidDupTopics: boolean,
): CandidateRow[] {
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  if (!avoidDupTopics) return shuffled.slice(0, n);

  const out: CandidateRow[] = [];
  const usedTopics = new Set<string>();
  // First pass: respect dedupe.
  for (const c of shuffled) {
    if (out.length >= n) break;
    const key = c.topic_id ?? `__null__${out.length}`;
    if (usedTopics.has(key)) continue;
    usedTopics.add(key);
    out.push(c);
  }
  // Second pass: backfill if dedupe left us short.
  if (out.length < n) {
    const taken = new Set(out.map((c) => c.id));
    for (const c of shuffled) {
      if (out.length >= n) break;
      if (!taken.has(c.id)) out.push(c);
    }
  }
  return out;
}

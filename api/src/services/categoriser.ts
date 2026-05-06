/**
 * Categorise a clipped MCQ question via Gemini 2.5 Flash vision:
 *   image (PNG of the clipped strip) + ocr_text + per-section topic tree
 *   -> { topic_code | null, summary, keywords[], difficulty 1..5 }
 *
 * Topic codes come from the `topics` table seeded from
 * `syllabus/syllabus.seed.json`. The model picks one dominant topic
 * code from the section's allowed list; null is permitted when a
 * question doesn't fit any topic cleanly.
 */

import { Type } from '@google/genai';
import type { SectionCode } from '@esat/shared-types';
import { query } from '../db.js';
import { readBytes } from '../storage.js';
import { callGemini, getGeminiClient } from './gemini.js';

export interface CategorisedQuestion {
  topic_code: string | null;
  summary: string;
  keywords: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
}

interface TopicScope {
  tree: string;
  allowed: string[];
}

const sectionScopeCache = new Map<SectionCode, TopicScope>();

async function getSectionScope(section: SectionCode): Promise<TopicScope> {
  const cached = sectionScopeCache.get(section);
  if (cached) return cached;
  const rows = await query<{ code: string; name: string }>(
    `SELECT code, name FROM topics WHERE section_code = $1 ORDER BY code`,
    [section],
  );
  const tree = rows.rows.map((t) => `${t.code}. ${t.name}`).join('\n') || '(no topics seeded)';
  const allowed = rows.rows.map((t) => t.code);
  const scope = { tree, allowed };
  sectionScopeCache.set(section, scope);
  return scope;
}

/** Drop the in-memory scope cache (e.g. after re-seeding topics). */
export function invalidateTopicScopeCache(): void {
  sectionScopeCache.clear();
}

const SCHEMA = {
  type: Type.OBJECT,
  required: ['topic_code', 'summary', 'keywords', 'difficulty'],
  properties: {
    topic_code: {
      type: Type.STRING,
      description:
        "Dominant topic code from the allowed list, e.g. 'P3'. Empty string if no topic fits.",
    },
    summary: { type: Type.STRING, description: 'Short title-style summary, ≤ 12 words.' },
    keywords: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3–6 concise subject-relevant terms.',
    },
    difficulty: {
      type: Type.INTEGER,
      description:
        '1 (easiest) – 5 (hardest). 1=routine recall, 3=multi-step apply, 5=synthesis or unfamiliar context.',
    },
  },
};

export async function categoriseQuestion(args: {
  testCode: 'ESAT' | 'ENGAA' | 'NSAA';
  sectionCode: SectionCode;
  questionNumber: number;
  imagePath: string;
  ocrText: string | null;
}): Promise<CategorisedQuestion> {
  const { tree, allowed } = await getSectionScope(args.sectionCode);
  const imageBytes = await readBytes(args.imagePath);

  const prompt = `You are categorising a ${args.testCode} ${args.sectionCode} multiple-choice question (Oxbridge admissions test).

The clipped question image is the source of truth; OCR text is provided as a fallback for math/symbol-heavy stems where vision may slip.

Topic list for this section (pick exactly one code or leave empty):
${tree}

Return JSON. Rules:
- topic_code: MUST be one of [${allowed.join(', ')}] — the SINGLE most dominant topic. Use the empty string "" if none fit, but only when truly ambiguous.
- summary: ≤ 12 words. No lead-in phrase ("This question asks…"). Imperative or noun-phrase. Example: "Resolve forces on inclined plane to find friction coefficient." or "Mole ratio in limiting-reagent stoichiometry calculation."
- keywords: 3–6 concise terms. Use canonical subject vocabulary.
- difficulty: 1 (routine recall / single-step) … 3 (multi-step application) … 5 (synthesis or unfamiliar context). Calibrate against typical ESAT/ENGAA/NSAA distractor density and time pressure (~90 seconds per question).

OCR fallback (may be empty or noisy):
${(args.ocrText ?? '').slice(0, 2000)}`;

  const resp = await callGemini(() =>
    getGeminiClient().models.generateContent({
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/png', data: imageBytes.toString('base64') } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        temperature: 0.2,
      },
    }),
  );

  const raw = resp.text ?? '';
  if (!raw.trim()) throw new Error('categoriser: empty Gemini response');
  const parsed = JSON.parse(raw) as CategorisedQuestion;

  // Normalise: empty-string topic_code -> null.
  if (typeof parsed.topic_code === 'string' && parsed.topic_code.trim() === '') {
    parsed.topic_code = null;
  }
  // Defensive clamp.
  const d = Number(parsed.difficulty);
  parsed.difficulty = (Math.max(1, Math.min(5, Math.round(d))) as 1 | 2 | 3 | 4 | 5);

  return parsed;
}

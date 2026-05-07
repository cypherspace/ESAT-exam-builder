/**
 * Categorise a clipped MCQ question via Gemini 2.5 Flash vision:
 *   image (PNG of the clipped strip) + ocr_text + per-test topic tree
 *   -> { section_code, topic_code | null, summary, keywords[], difficulty 1..5 }
 *
 * For ESAT, the QP carries explicit section dividers and the clipper has
 * already routed each question to its true section — so the categoriser is
 * scoped to that one section's topic list. For ENGAA / NSAA the QP bundles
 * multiple subjects in one Section 1 paper without internal headers, so
 * the categoriser sees the union of every allowed section's topics and is
 * asked to pick *both* the right section and the right topic.
 *
 * The orchestrator (`categorise-exam.ts`) moves the question to a different
 * section_id when the returned section differs from the one it was clipped
 * under.
 */

import { Type } from '@google/genai';
import type { SectionCode, TestCode } from '@esat/shared-types';
import { query } from '../db.js';
import { readBytes } from '../storage.js';
import { callGemini, getGeminiClient } from './gemini.js';

export interface CategorisedQuestion {
  /**
   * Section the model believes this question belongs to. May differ from
   * the section the question was clipped under (ENGAA Section 1 questions
   * are clipped as MATHS1 by default and re-routed here).
   */
  section_code: SectionCode;
  topic_code: string | null;
  summary: string;
  keywords: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
}

interface ScopeKey {
  testCode: TestCode;
  primarySection: SectionCode;
}

interface Scope {
  /** Allowed section codes, e.g. ['MATHS1','PHYSICS','ADV_MATHS'] for ENGAA. */
  sections: SectionCode[];
  /** Allowed topic codes per section, e.g. {MATHS1: ['M1','M2',...], ...}. */
  topicsBySection: Record<string, string[]>;
  /** Pretty tree the prompt embeds. */
  tree: string;
  /** True when this scope is cross-section (categoriser must also pick the section). */
  crossSection: boolean;
}

const scopeCache = new Map<string, Scope>();

// Mirror of api/src/sections.ts — the categoriser doesn't import that file
// to avoid a circular dependency, but the scopes have to stay in sync.
const ALLOWED_SECTIONS: Record<TestCode, SectionCode[]> = {
  // ESAT entry stays for legacy rows (no new uploads use it). Same six
  // sections as before, in case we ever need to recategorise an ESAT row.
  ESAT: ['MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY'],
  ENGAA: ['MATHS1', 'PHYSICS', 'MATHS2'],
  NSAA: ['MATHS1', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'MATHS2'],
  PAT: ['MATHS1', 'MATHS2', 'PHYSICS'],
};

const SECTION_LABEL: Record<SectionCode, string> = {
  MATHS1: 'Mathematics 1',
  MATHS2: 'Mathematics 2 (incl. Advanced Mathematics)',
  PHYSICS: 'Physics',
  CHEMISTRY: 'Chemistry',
  BIOLOGY: 'Biology',
  ADV_MATHS: 'Advanced Mathematics (legacy — collapsed into MATHS2)',
};

// Brief content hints embedded in the prompt next to each topic name.
// Without these the model sees only e.g. "P3. Mechanics" and guesses the
// scope; with them it picks the right topic far more reliably.
const TOPIC_HINTS: Record<string, string> = {
  // Physics — P1..P7
  P1: 'circuits, resistance, current, voltage, capacitance, electric fields, charge, power dissipation, transformers in a circuit context',
  P2: 'magnetic fields, electromagnetic induction, motors, transformers (induction), force on moving charges',
  P3: 'kinematics, dynamics, Newton\'s laws, momentum, energy, work, gravitation, orbits, projectile motion, fluid statics, moments, oscillations, circular motion',
  P4: 'temperature, heat capacity, latent heat, gas laws, thermodynamics, conduction / convection / radiation, blackbody',
  P5: 'states of matter, density, pressure, fluids, particle model, atomic structure (chemistry-adjacent), nuclear structure',
  P6: 'wave properties, frequency, wavelength, reflection, refraction, diffraction, interference, EM spectrum, optics, Snell\'s law',
  P7: 'radioactive decay, half-life, nuclear reactions, alpha/beta/gamma, fission, fusion, mass-energy equivalence',
  // Maths 1 — M1..M7
  M1: 'SI units, dimensional analysis, unit conversions',
  M2: 'integers, fractions, decimals, percentages, surds, indices, prime factorisation',
  M3: 'ratios, proportions, scaling, direct/inverse proportion',
  M4: 'simplifying expressions, solving linear and quadratic equations, simultaneous equations, basic algebraic manipulation, inequalities',
  M5: 'angles, triangles, polygons, circles, area, perimeter, volume, similar shapes, Pythagoras, basic 2D/3D geometry',
  M6: 'mean, median, mode, range, standard deviation, data interpretation, charts',
  M7: 'simple probability, combined events, tree diagrams, expected outcomes',
  // Maths 2 / Advanced — N1..N8
  N1: 'functions and their properties, transformations, polynomial / rational / modulus functions, factor and remainder theorems, partial fractions',
  N2: 'arithmetic and geometric sequences and series, sum to n, sum to infinity, binomial expansion',
  N3: 'lines and circles in the x-y plane, gradient, distance, midpoint, parametric forms',
  N4: 'sin, cos, tan, identities, equations, sine/cosine rule, radians, trig graphs',
  N5: 'exponential and logarithmic functions, log laws, modelling, e^x, ln x',
  N6: 'differentiation from first principles, rules, chain/product/quotient, stationary points, optimisation',
  N7: 'definite and indefinite integration, area under a curve, volumes of revolution, integration by parts/substitution',
  N8: 'graph sketching, asymptotes, transformations of curves, identifying functions from graphs',
  // Chemistry C1..C17
  C1: 'protons, neutrons, electrons, isotopes, electron configuration',
  C2: 'periodic trends, groups, periods, electronegativity, atomic radius',
  C3: 'balancing equations, formulae, types of reaction, conservation of mass',
  C4: 'moles, molar mass, stoichiometry, limiting reagent, percentage yield',
  C5: 'oxidation states, redox half-equations, oxidising / reducing agents',
  C6: 'ionic / covalent / metallic bonding, intermolecular forces, structure → property links',
  C7: 'Group 1, Group 2, halogens, transition metals, noble gases',
  C8: 'filtration, distillation, chromatography, recrystallisation',
  C9: 'pH, neutralisation, indicators, salts, acid + base reactions',
  C10: 'rate of reaction, factors affecting rate, catalysts',
  C11: 'enthalpy changes, exothermic / endothermic, bond enthalpies, calorimetry',
  C12: 'electrolysis cells, ions discharged, electrode products',
  C13: 'alkanes, alkenes, alcohols, polymers, isomers, functional groups',
  C14: 'extraction, reactivity series, displacement, alloys',
  C15: 'states, kinetic theory, gas pressure, diffusion',
  C16: 'flame tests, identification of cations/anions, gas tests',
  C17: 'composition of air, water purification, pollutants, carbon cycle',
  // Biology B1..B11
  B1: 'cell structure, organelles, prokaryotes vs eukaryotes',
  B2: 'diffusion, osmosis, active transport',
  B3: 'mitosis, meiosis, sex chromosomes',
  B4: 'genes, alleles, dominant / recessive, monohybrid crosses',
  B5: 'DNA structure, replication, transcription, translation',
  B6: 'genetic engineering, PCR, GMOs, gene therapy',
  B7: 'continuous / discontinuous variation, mutations, evolution',
  B8: 'enzyme action, lock and key, factors affecting enzyme activity',
  B9: 'circulation, respiration, digestion, nervous system, hormones',
  B10: 'food chains, energy flow, nitrogen / carbon cycles, biodiversity',
  B11: 'photosynthesis, transpiration, transport in plants',
};

async function getScope({ testCode, primarySection }: ScopeKey): Promise<Scope> {
  // For ENGAA / NSAA / PAT we let the model choose across all of the test's
  // allowed sections — those papers bundle multiple subjects with no internal
  // headers. ESAT keeps a single-section scope (clipping is reliable there).
  const crossSection =
    testCode === 'ENGAA' || testCode === 'NSAA' || testCode === 'PAT';
  const sections: SectionCode[] = crossSection
    ? ALLOWED_SECTIONS[testCode]
    : [primarySection];
  const cacheKey = `${testCode}:${crossSection ? 'multi' : primarySection}`;
  const cached = scopeCache.get(cacheKey);
  if (cached) return cached;

  const rows = await query<{ section_code: SectionCode; code: string; name: string }>(
    `SELECT section_code, code, name FROM topics
     WHERE section_code = ANY($1::section_code[])
     ORDER BY section_code, code`,
    [sections],
  );

  const topicsBySection: Record<string, string[]> = {};
  for (const s of sections) topicsBySection[s] = [];
  for (const r of rows.rows) {
    topicsBySection[r.section_code]?.push(r.code);
  }

  // Pretty multi-section tree with content hints:
  //   PHYSICS — Physics
  //     P1. Electricity — circuits, resistance, …
  //     P2. Magnetism — magnetic fields, induction, …
  //     ...
  const treeParts: string[] = [];
  for (const s of sections) {
    treeParts.push(`${s} — ${SECTION_LABEL[s]}`);
    const rs = rows.rows.filter((r) => r.section_code === s);
    if (rs.length === 0) {
      treeParts.push('  (no topics seeded — leave empty for this section)');
    } else {
      for (const r of rs) {
        const hint = TOPIC_HINTS[r.code];
        treeParts.push(`  ${r.code}. ${r.name}${hint ? ` — ${hint}` : ''}`);
      }
    }
  }

  const scope: Scope = {
    sections,
    topicsBySection,
    tree: treeParts.join('\n'),
    crossSection,
  };
  scopeCache.set(cacheKey, scope);
  return scope;
}

/** Drop the in-memory scope cache (e.g. after re-seeding topics). */
export function invalidateTopicScopeCache(): void {
  scopeCache.clear();
}

const SCHEMA = {
  type: Type.OBJECT,
  required: ['section_code', 'topic_code', 'summary', 'keywords', 'difficulty'],
  properties: {
    section_code: {
      type: Type.STRING,
      description:
        "Section the question belongs to: MATHS1 | MATHS2 | PHYSICS | CHEMISTRY | BIOLOGY | ADV_MATHS. Pick from the allowed list shown in the prompt.",
    },
    topic_code: {
      type: Type.STRING,
      description:
        "Dominant topic code from the chosen section's allowed list, e.g. 'P3'. Empty string if no topic fits.",
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
  testCode: TestCode;
  sectionCode: SectionCode;
  questionNumber: number;
  imagePath: string;
  ocrText: string | null;
}): Promise<CategorisedQuestion> {
  const scope = await getScope({
    testCode: args.testCode,
    primarySection: args.sectionCode,
  });
  const imageBytes = await readBytes(args.imagePath);

  const sectionGuidance = scope.crossSection
    ? `This is a ${args.testCode} paper that mixes multiple subjects in one section without internal headers. Decide which subject section this question belongs to AND which topic within that section.

Allowed sections: [${scope.sections.join(', ')}].

Heuristic:
  - Algebra (basic), geometry, statistics, probability, ratio, number, units → MATHS1
  - Calculus, sequences & series, trigonometry beyond basics, exponentials/logs, advanced functions, coordinate geometry, graph sketching → MATHS2
  - Forces, energy, electricity, magnetism, waves, fields, radioactivity, thermal, matter → PHYSICS
  - Reactions, atomic structure, periodic table, organic, electrolysis, energetics, kinetics, group chemistry, separation, acids/bases → CHEMISTRY
  - Cells, inheritance, DNA, enzymes, ecosystems, animal/plant physiology → BIOLOGY`
    : `This question was clipped from the ${SECTION_LABEL[args.sectionCode]} section. Use section_code = "${args.sectionCode}".`;

  const prompt = `You are categorising a ${args.testCode} multiple-choice question (Oxbridge admissions test).

The clipped question image is the source of truth; OCR text is provided as a fallback for math/symbol-heavy stems where vision may slip.

${sectionGuidance}

Topic tree (pick exactly one topic_code from the chosen section, or empty string if none fits):
${scope.tree}

Return JSON. Rules:
- section_code: one of [${scope.sections.join(', ')}]. Match the question's content, not its position in the paper.
- topic_code: one of the codes listed UNDER your chosen section_code above. The taxonomy is intentionally broad — every Physics question that involves ANY mechanics-like concept (forces, energy, momentum, kinematics, gravity, fluids, moments) belongs in P3; every electricity-or-circuit question in P1; every wave / optics / EM-spectrum question in P6; etc. Pick the closest topic. Only use the empty string "" when the question genuinely has no relation to any code under the chosen section. Don't leave it blank just because the question spans two topics — pick the dominant one.
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

  // Validate section_code against the scope, else fall back to the section
  // the question was clipped under.
  if (!scope.sections.includes(parsed.section_code)) {
    parsed.section_code = args.sectionCode;
  }

  // Topic code must belong to the chosen section.
  const allowedForSection = scope.topicsBySection[parsed.section_code] ?? [];
  if (typeof parsed.topic_code !== 'string' || parsed.topic_code.trim() === '') {
    parsed.topic_code = null;
  } else if (!allowedForSection.includes(parsed.topic_code)) {
    parsed.topic_code = null;
  }

  // Defensive clamp on difficulty.
  const d = Number(parsed.difficulty);
  parsed.difficulty = (Math.max(1, Math.min(5, Math.round(d))) as 1 | 2 | 3 | 4 | 5);

  return parsed;
}

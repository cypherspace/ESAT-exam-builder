import type { SectionCode, TestCode } from '@esat/shared-types';

// ENGAA Section 1 papers bundle Maths + Physics in one paper with no
// internal section header — the categoriser routes each Q to MATHS1 or
// PHYSICS based on content. ENGAA Section 2 / NSAA Part E ("Advanced
// Mathematics") is treated as MATHS2 — the topic taxonomy for "Advanced
// Mathematics" matches MATHS2 (algebra & functions, sequences, calculus
// etc.) and we keep one section per topic family.
export const SECTIONS_BY_TEST: Record<TestCode, SectionCode[]> = {
  ESAT: ['MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY'],
  ENGAA: ['MATHS1', 'PHYSICS', 'MATHS2'],
  NSAA: ['MATHS1', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'MATHS2'],
};

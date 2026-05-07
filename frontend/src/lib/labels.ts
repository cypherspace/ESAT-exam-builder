import type { SectionCode, TestCode } from '@esat/shared-types';

// ESAT is gone from the UI: there are no fixtures we can ingest, and the
// product has shifted to ENGAA / NSAA / PAT past papers.
export const TEST_CODES: TestCode[] = ['ENGAA', 'NSAA', 'PAT'];

export const SECTION_LABEL: Record<SectionCode, string> = {
  MATHS1: 'Maths 1',
  MATHS2: 'Maths 2',
  PHYSICS: 'Physics',
  CHEMISTRY: 'Chemistry',
  BIOLOGY: 'Biology',
  ADV_MATHS: 'Advanced Maths',
};

export const SECTION_CODES: SectionCode[] = [
  'MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ADV_MATHS',
];

export function sectionLabel(code: SectionCode): string {
  return SECTION_LABEL[code];
}

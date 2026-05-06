import type { SectionCode, TestCode } from '@esat/shared-types';

export const TEST_CODES: TestCode[] = ['ESAT', 'ENGAA', 'NSAA'];

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

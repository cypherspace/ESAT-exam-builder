import type { SectionCode, TestCode } from '@esat/shared-types';

export const SECTIONS_BY_TEST: Record<TestCode, SectionCode[]> = {
  ESAT: ['MATHS1', 'MATHS2', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ADV_MATHS'],
  ENGAA: ['MATHS1', 'ADV_MATHS'],
  NSAA: ['MATHS1', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY'],
};

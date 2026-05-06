/**
 * Shared types between @esat/api and @esat/frontend.
 * Source of truth for the wire format.
 */

export type TestCode = 'ESAT' | 'ENGAA' | 'NSAA';

export type SectionCode =
  | 'MATHS1'
  | 'MATHS2'
  | 'PHYSICS'
  | 'CHEMISTRY'
  | 'BIOLOGY'
  | 'ADV_MATHS';

// Cambridge admissions papers can have questions with more than 5 options
// (we've seen up to 8); the DB enum covers A–Z to match.
export type AnswerKey =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';

export type QuestionType = 'multiple_choice' | 'short_answer' | 'structured';

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export type ExamStatus = 'pending' | 'extracting' | 'ready' | 'error';

export type UserRole = 'teacher' | 'admin' | 'student';

export interface Exam {
  id: string;
  test_code: TestCode;
  year: number;
  sitting: string;
  source_pdf_path: string;
  ms_pdf_path: string | null;
  status: ExamStatus;
}

export interface Section {
  id: string;
  exam_id: string;
  code: SectionCode;
  question_count: number;
}

export interface Topic {
  id: string;
  section_code: SectionCode;
  code: string;
  name: string;
}

export interface Question {
  id: string;
  section_id: string;
  number: number;
  image_path: string;
  ocr_text: string | null;
  answer_key: AnswerKey | null;
  question_type: QuestionType;
  topic_id: string | null;
  difficulty: Difficulty | null;
  summary: string | null;
  keywords: string[];
}

export type DraftItem =
  | { type: 'question'; question_id: string; display_number?: number }
  | { type: 'blank'; label?: string };

export interface PaperDraft {
  id: string;
  owner_id: string;
  name: string;
  items: DraftItem[];
  time_limit_minutes: number | null;
  instructions: string | null;
  updated_at: string;
}

export interface Flag {
  id: string;
  question_id: string;
  user_id: string;
  note: string;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
}

export interface Me {
  id: string;
  email: string;
  role: UserRole;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

export interface GenerateRequest {
  name?: string;
  test_code: TestCode;
  section_mix: Partial<
    Record<
      SectionCode,
      {
        count: number;
        topics?: string[];
        difficulty_range?: [Difficulty, Difficulty];
      }
    >
  >;
  avoid_duplicate_topics?: boolean;
}

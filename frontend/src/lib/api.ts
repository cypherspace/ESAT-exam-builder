import type {
  AnswerKey,
  Difficulty,
  DraftItem,
  Exam,
  Flag,
  PaperDraft,
  Paginated,
  Question,
  SectionCode,
  TestCode,
  Topic,
} from '@esat/shared-types';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('esat:unauthorized'));
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export interface QuestionListItem extends Question {
  section_code: SectionCode;
  test_code: TestCode;
  year: number;
  sitting: string;
}

export interface QuestionFilter {
  test_code?: TestCode;
  section?: SectionCode;
  topic_id?: string;
  year?: number;
  /** Restrict to questions with (true) or without (false) a topic_id. */
  categorised?: 'true' | 'false';
  difficulty_min?: Difficulty;
  difficulty_max?: Difficulty;
  page?: number;
  limit?: number;
}

function buildQs(filter: QuestionFilter): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  return qs;
}

export const api = {
  me: () => request<{ id: string; email: string; role: string }>('/api/v1/auth/me'),

  topics: (section?: SectionCode) =>
    request<{ data: Topic[] }>(
      `/api/v1/topics${section ? `?section=${section}` : ''}`,
    ),

  exams: (page = 1, limit = 50) =>
    request<Paginated<Exam>>(`/api/v1/exams?page=${page}&limit=${limit}`),

  exam: (id: string) =>
    request<
      Exam & { sections: { id: string; code: SectionCode; question_count: number }[] }
    >(`/api/v1/exams/${id}`),

  retryExtract: (id: string) =>
    request<{ questions_inserted: number; warnings: string[] }>(
      `/api/v1/exams/${id}/extract`,
      { method: 'POST', body: '{}' },
    ),

  categoriseExam: (id: string, force = false) =>
    request<{
      total: number;
      categorised: number;
      skipped: number;
      failed: { question_id: string; error: string }[];
    }>(`/api/v1/exams/${id}/categorise${force ? '?force=1' : ''}`, {
      method: 'POST',
      body: '{}',
    }),

  uploadExam: async (input: {
    test_code: TestCode;
    year: number;
    sitting: string;
    qp: File;
    ms: File | null;
  }) => {
    const fd = new FormData();
    fd.set('test_code', input.test_code);
    fd.set('year', String(input.year));
    fd.set('sitting', input.sitting);
    fd.set('qp', input.qp);
    if (input.ms) fd.set('ms', input.ms);
    const res = await fetch(`${API_BASE}/api/v1/exams/upload`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
    }
    return (await res.json()) as Exam;
  },

  questions: (filter: QuestionFilter) =>
    request<Paginated<QuestionListItem>>(`/api/v1/questions?${buildQs(filter).toString()}`),

  question: (id: string) => request<QuestionListItem>(`/api/v1/questions/${id}`),

  patchQuestion: (
    id: string,
    patch: Partial<{
      topic_id: string | null;
      difficulty: Difficulty | null;
      summary: string | null;
      keywords: string[];
      answer_key: AnswerKey | null;
    }>,
  ) =>
    request<Question>(`/api/v1/questions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  flagQuestion: (id: string, note: string) =>
    request<Flag>(`/api/v1/questions/${id}/flags`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  categoriseQuestion: (id: string) =>
    request<{
      moved: boolean;
      section_code: SectionCode;
      topic_id: string | null;
    }>(`/api/v1/questions/${id}/categorise`, { method: 'POST', body: '{}' }),

  categoriseUncategorised: (body: {
    test_code?: TestCode;
    section?: SectionCode;
    limit?: number;
  }) =>
    request<{
      total: number;
      categorised: number;
      moved: number;
      failed: { question_id: string; error: string }[];
    }>('/api/v1/questions/categorise-uncategorised', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  drafts: () => request<{ data: PaperDraft[] }>('/api/v1/drafts'),

  draft: (id: string) => request<PaperDraft>(`/api/v1/drafts/${id}`),

  createDraft: (body: {
    name: string;
    items?: DraftItem[];
    time_limit_minutes?: number | null;
    instructions?: string | null;
  }) =>
    request<PaperDraft>('/api/v1/drafts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchDraft: (
    id: string,
    body: Partial<{
      name: string;
      items: DraftItem[];
      time_limit_minutes: number | null;
      instructions: string | null;
    }>,
  ) =>
    request<PaperDraft>(`/api/v1/drafts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteDraft: (id: string) =>
    request<void>(`/api/v1/drafts/${id}`, { method: 'DELETE' }),

  flags: (status?: 'open' | 'resolved' | 'dismissed') =>
    request<{ data: Flag[] }>(`/api/v1/flags${status ? `?status=${status}` : ''}`),

  patchFlag: (id: string, status: 'open' | 'resolved' | 'dismissed') =>
    request<Flag>(`/api/v1/flags/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  exportDraft: (
    id: string,
    opts: { mode?: 'separate' | 'interleaved' | 'sequential'; include_cover?: boolean } = {},
  ) =>
    request<{
      mode: 'separate' | 'interleaved' | 'sequential';
      qp_uri?: string;
      ms_uri?: string;
      combined_uri?: string;
    }>(`/api/v1/export/draft/${id}`, {
      method: 'POST',
      body: JSON.stringify({
        mode: opts.mode ?? 'separate',
        include_cover: opts.include_cover ?? true,
      }),
    }),

  generate: (body: {
    name?: string;
    test_code: TestCode;
    section_mix: Partial<
      Record<
        SectionCode,
        { count: number; topics?: string[]; difficulty_range?: [Difficulty, Difficulty] }
      >
    >;
    avoid_duplicate_topics?: boolean;
    save_as_draft?: boolean;
  }) =>
    request<{
      question_ids: string[];
      by_section: { section: SectionCode; picked: number; requested: number }[];
      unfilled: { section: SectionCode; reason: string }[];
      draft_id?: string | null;
    }>('/api/v1/generate', { method: 'POST', body: JSON.stringify(body) }),
};

export function fileUrl(uri: string): string {
  return `${API_BASE}/files?u=${encodeURIComponent(uri)}`;
}

/**
 * Trigger a browser download for the URL by creating an <a download>
 * element and clicking it. More reliable than window.open() from an
 * async callback (which Chrome treats as a popup and blocks). The
 * server already sends Content-Disposition: attachment for PDFs, so
 * the browser saves the file rather than navigating to it.
 */
export function triggerDownload(url: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

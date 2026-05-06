import type {
  Exam,
  Paginated,
  Question,
  Topic,
  TestCode,
  SectionCode,
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

export const api = {
  me: () => request<{ id: string; email: string; role: string }>('/api/v1/auth/me'),

  topics: (section?: SectionCode) =>
    request<{ data: Topic[] }>(
      `/api/v1/topics${section ? `?section=${section}` : ''}`,
    ),

  exams: (page = 1, limit = 50) =>
    request<Paginated<Exam>>(`/api/v1/exams?page=${page}&limit=${limit}`),

  exam: (id: string) => request<Exam>(`/api/v1/exams/${id}`),

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

  questions: (qs: URLSearchParams) =>
    request<Paginated<QuestionListItem>>(`/api/v1/questions?${qs.toString()}`),
};

export function fileUrl(uri: string): string {
  return `${API_BASE}/files?u=${encodeURIComponent(uri)}`;
}

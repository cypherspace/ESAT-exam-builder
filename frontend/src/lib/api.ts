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
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ id: string; email: string; role: string }>('/api/v1/auth/me'),
  topics: () => request<{ data: unknown[] }>('/api/v1/topics'),
  questions: (qs = '') =>
    request<{ data: unknown[]; meta: { page: number; limit: number; total: number } }>(
      `/api/v1/questions${qs}`,
    ),
};

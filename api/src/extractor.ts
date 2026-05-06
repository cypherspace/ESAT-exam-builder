import { request } from 'undici';

const baseUrl = process.env.EXTRACTOR_URL ?? 'http://localhost:8081';

export interface ExtractMsRequest {
  ms_uri: string;
}

export interface ExtractMsResponse {
  answer_key: Record<string, 'A' | 'B' | 'C' | 'D' | 'E'>;
  warnings: string[];
}

export interface ExtractRequest {
  exam_id: string;
  test_code: 'ESAT' | 'ENGAA' | 'NSAA';
  qp_uri: string;
  ms_uri: string | null;
}

export interface ExtractedQuestion {
  number: number;
  page_index: number;
  bbox: [number, number, number, number];
  image_uri: string;
  ocr_text: string;
}

export interface ExtractResponse {
  exam_id: string;
  questions: ExtractedQuestion[];
  answer_key: Record<string, 'A' | 'B' | 'C' | 'D' | 'E'>;
  warnings: string[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await request(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.body.text();
  if (res.statusCode >= 400) {
    throw new Error(`extractor ${path} ${res.statusCode}: ${text}`);
  }
  return JSON.parse(text) as T;
}

export const extractor = {
  extractMs: (req: ExtractMsRequest) => post<ExtractMsResponse>('/extract-ms', req),
  extract: (req: ExtractRequest) => post<ExtractResponse>('/extract', req),
};

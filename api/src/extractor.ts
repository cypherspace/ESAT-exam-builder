import { request } from 'undici';

const baseUrl = process.env.EXTRACTOR_URL ?? 'http://localhost:8081';

import type { AnswerKey, SectionCode, TestCode } from '@esat/shared-types';

export interface ExtractMsRequest {
  ms_uri: string;
  default_section?: SectionCode;
}

export interface ExtractMsResponse {
  /** {section_code: {q_num: 'A'..'E'}} */
  answer_key: Partial<Record<SectionCode, Record<string, AnswerKey>>>;
  warnings: string[];
}

export interface ExtractRequest {
  exam_id: string;
  test_code: TestCode;
  qp_uri: string;
  ms_uri: string | null;
  default_section?: SectionCode;
  continuous_numbering?: boolean;
}

export interface ExtractedQuestion {
  section_code: SectionCode;
  number: number;
  page_index: number;
  bbox: [number, number, number, number];
  // Original question-number marker (x, y, w, h) in source PDF points.
  // null when the upstream extractor doesn't emit it.
  marker_bbox: [number, number, number, number] | null;
  image_uri: string;
  ocr_text: string;
}

export interface ExtractResponse {
  exam_id: string;
  test_code: TestCode;
  questions: ExtractedQuestion[];
  answer_key: Partial<Record<SectionCode, Record<string, AnswerKey>>>;
  warnings: string[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  // Large PDFs (90-question NSAA papers) routinely take 60–120s end-to-end
  // for clip rendering. Default undici headersTimeout is 5 min but the
  // bodyTimeout is 5 min too — push both to 10 min to cover slow runs.
  const res = await request(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    headersTimeout: 600_000,
    bodyTimeout: 600_000,
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

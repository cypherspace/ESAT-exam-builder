/**
 * Gemini call wrapper: concurrency throttle + 429 retry with exponential
 * backoff. Ported from CAIE — same shape, narrower surface.
 *
 * The categoriser fires per-question Gemini calls in parallel for an
 * exam (often 100+ calls). Without throttling that swamps the per-minute
 * Vertex AI quota and surfaces as cascading 429s. We cap in-flight calls
 * at GEMINI_CONCURRENCY (default 4) and retry transient 429s with
 * jittered exponential backoff.
 */

import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GEMINI_LOCATION ?? 'us-central1',
    });
  }
  return client;
}

const CONCURRENCY = Number(process.env.GEMINI_CONCURRENCY ?? 4);
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | undefined;
  if (!e) return false;
  if (e.status === 429) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callGemini<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  await acquire();
  try {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;
        if (!isRateLimit(err) || attempt >= maxAttempts) throw err;
        // Exponential backoff with ±30% jitter: 1s, 2s, 4s, 8s.
        const base = Math.min(8000, 1000 * 2 ** (attempt - 1));
        const wait = base * (0.7 + Math.random() * 0.6);
        console.warn(
          `Gemini 429: retry ${attempt}/${maxAttempts - 1} after ${Math.round(wait)}ms`,
        );
        await sleep(wait);
      }
    }
  } finally {
    release();
  }
}

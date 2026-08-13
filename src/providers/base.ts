/**
 * The machinery every network provider shares: batching, a small concurrency
 * pool, retry with backoff, status-code mapping and secret redaction.
 *
 * None of it touches a real socket — a `Transport` is passed in — so all of it
 * is exercised by the unit tests.
 */

import { qualityIssues } from './protect';
import { ParseError } from './prompt';
import type { HttpResponse } from './transport';
import { TransportError, parseJson } from './transport';
import type { ChunkPolicy, ProviderContext, TranslateRequest, TranslateResult } from './types';
import type { SourceString } from '../shared/types';

export const LLM_POLICY: ChunkPolicy = { maxItems: 40, maxChars: 6000, concurrency: 1 };
export const GOOGLE_POLICY: ChunkPolicy = { maxItems: 64, maxChars: 8000, concurrency: 1 };
export const DEEPL_POLICY: ChunkPolicy = { maxItems: 40, maxChars: 20000, concurrency: 1 };
/** The free endpoint takes one string per GET, so it leans on concurrency. */
export const GOOGLE_FREE_POLICY: ChunkPolicy = { maxItems: 1, maxChars: 1500, concurrency: 3 };

export const MAX_ATTEMPTS = 3;

/**
 * The server answered, but not with anything we can use — a missing
 * `translations` array, no message content, a blocked completion.
 *
 * Distinct from HttpError because it must not be retried: the request was
 * accepted, so sending the identical bytes again produces the identical
 * useless answer. It used to fall into the "unknown error, might be
 * transient" bucket and cost three attempts and two backoff sleeps before
 * reporting the reason it already knew on the first try.
 */
export class ResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseError';
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number;
  constructor(status: number, message: string, retryAfterMs: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function chunk(strings: SourceString[], policy: ChunkPolicy): SourceString[][] {
  const out: SourceString[][] = [];
  let current: SourceString[] = [];
  let chars = 0;
  for (const s of strings) {
    if (
      current.length &&
      (current.length >= policy.maxItems || chars + s.text.length > policy.maxChars)
    ) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(s);
    chars += s.text.length;
  }
  if (current.length) out.push(current);
  return out;
}

export async function pool(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let next = 0;
  const workers: Array<Promise<void>> = [];
  const width = Math.max(1, Math.min(limit, tasks.length));
  for (let i = 0; i < width; i++) {
    workers.push(
      (async () => {
        while (next < tasks.length) {
          const index = next++;
          await tasks[index]();
        }
      })()
    );
  }
  await Promise.all(workers);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Strips anything resembling the secret out of a message before display. */
export function redact(message: string, secret: string): string {
  if (!secret || secret.length < 8) return message;
  return message.split(secret).join('***');
}

/**
 * Builds an HttpError from a failed response. `describe` lets a provider map
 * its own status codes (DeepL's 456 quota, for example) to a plain sentence.
 */
export function httpError(
  res: HttpResponse,
  describe?: (status: number, detail: string) => string | null
): HttpError {
  let detail = '';
  const json = parseJson(res.body);
  if (json) {
    detail =
      (json.error && (json.error.message || json.error)) ||
      json.message ||
      (Array.isArray(json.errors) && json.errors[0] && json.errors[0].message) ||
      '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  }
  if (!detail) detail = res.body || res.statusText;
  if (detail.length > 240) detail = detail.slice(0, 240) + '…';

  let retryAfterMs = 0;
  const header = res.headers['retry-after'];
  if (header) {
    const seconds = parseFloat(header);
    if (!isNaN(seconds)) retryAfterMs = Math.min(30000, seconds * 1000);
  }

  const custom = describe ? describe(res.status, detail) : null;
  let message = custom || 'HTTP ' + res.status + ': ' + detail;
  if (!custom) {
    if (res.status === 401 || res.status === 403) {
      message = 'Invalid or unauthorized API key (HTTP ' + res.status + '). ' + detail;
    } else if (res.status === 429) {
      message = 'Rate limited by the provider (HTTP 429). ' + detail;
    }
  }
  return new HttpError(res.status, message.trim(), retryAfterMs);
}

/** Retries only on rate limits, server errors and transport failures. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  isCancelled?: () => boolean,
  wait: (ms: number) => Promise<void> = sleep
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (isCancelled && isCancelled()) throw new Error('Cancelled.');
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      let retryable: boolean;
      if (e instanceof HttpError) {
        // The server answered, so only rate limits and server faults are worth another go.
        retryable = e.status === 429 || e.status >= 500;
      } else if (e instanceof ResponseError || e instanceof ParseError) {
        // Deterministic: the same request yields the same unusable answer. A
        // model that returned prose has already had its one nudge by here.
        retryable = false;
      } else if (e instanceof TransportError) {
        retryable = e.retryable;
      } else {
        retryable = true;
      }
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const retryAfter = e instanceof HttpError ? e.retryAfterMs : 0;
      await wait(retryAfter || attempt * attempt * 1200);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Shared batch loop. One request per batch of strings — never one per layer,
 * except for the free Google endpoint which physically cannot batch. A failing
 * batch never discards the batches that already succeeded.
 */
export async function runChunks(
  req: TranslateRequest,
  ctx: ProviderContext,
  send: (items: SourceString[], retryNudge: boolean) => Promise<Record<string, string>>,
  secret: string,
  policy: ChunkPolicy
): Promise<TranslateResult> {
  const batches = chunk(req.strings, policy);
  const translations: Record<string, string> = {};
  const issues: string[] = [];
  const errors: string[] = [];
  let completed = 0;

  const tasks = batches.map((items, index) => async () => {
    if (ctx.isCancelled && ctx.isCancelled()) return;
    try {
      const parsed = await withRetry(async () => {
        try {
          return await send(items, false);
        } catch (e) {
          // Give a model exactly one nudge before writing the batch off.
          if (e instanceof ParseError) return await send(items, true);
          throw e;
        }
      }, ctx.isCancelled);

      for (const key of Object.keys(parsed)) translations[key] = parsed[key];
      const returned = Object.keys(parsed).length;
      if (returned < items.length) {
        issues.push(
          'Batch ' +
            (index + 1) +
            '/' +
            batches.length +
            ': ' +
            (items.length - returned) +
            ' string(s) came back missing.'
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push('Batch ' + (index + 1) + '/' + batches.length + ': ' + redact(message, secret));
    }
    completed++;
    if (ctx.onProgress) ctx.onProgress(completed, batches.length);
  });

  await pool(tasks, policy.concurrency);

  for (const issue of qualityIssues(req.strings, translations, ctx.doNotTranslate)) {
    issues.push(issue);
  }

  return {
    translations,
    error: errors.length ? errors.join(' ') : undefined,
    issues,
  };
}

export function hasBudgets(req: TranslateRequest): boolean {
  return !!req.budgets && Object.keys(req.budgets).length > 0;
}

/** A provider that has no key configured fails the same way everywhere. */
export function missingKey(name: string): TranslateResult {
  return { translations: {}, error: 'No ' + name + ' API key entered.', issues: [] };
}

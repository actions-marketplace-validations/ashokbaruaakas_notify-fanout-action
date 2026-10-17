import { DeliveryError } from '../providers/types.js';
import type { SendContext, SendResult } from '../providers/types.js';

export interface DeliveryJob {
  id: string;
  provider: string;
  send(context: SendContext): Promise<SendResult>;
}

export interface DeliveryResult {
  id: string;
  provider: string;
  ok: boolean;
  attempts: number;
  messageId?: string;
  error?: string;
}

export interface EngineOptions {
  concurrency: number;
  /** Retries after the first attempt, for retryable errors only. */
  retries: number;
  timeoutMs: number;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Returns a number in [0, 1), for backoff jitter. */
  random: () => number;
  debug: (message: string) => void;
}

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
/** A server asking us to wait longer than this fails the target instead of stalling the job. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** Exponential backoff with jitter: 50–100% of base·2^(attempt-1), capped. */
export function backoffDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.round(ceiling * (0.5 + random() / 2));
}

/**
 * Delivers every job with bounded concurrency. Jobs are independent: a
 * failure is recorded in that job's result and never affects the others.
 * Results are in the same order as `jobs`.
 */
export async function deliverAll(
  jobs: readonly DeliveryJob[],
  options: EngineOptions,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < jobs.length; index = next++) {
      const job = jobs[index];
      if (job) results[index] = await deliver(job, options);
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency, jobs.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

async function deliver(job: DeliveryJob, options: EngineOptions): Promise<DeliveryResult> {
  const base = { id: job.id, provider: job.provider };
  const state = new Map<string, unknown>();
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await job.send({
        signal: AbortSignal.timeout(options.timeoutMs),
        timeoutMs: options.timeoutMs,
        attempt,
        fetch: options.fetch,
        debug: options.debug,
        state,
      });
      return {
        ...base,
        ok: true,
        attempts: attempt,
        ...(result.messageId === undefined ? {} : { messageId: result.messageId }),
      };
    } catch (thrown) {
      const error =
        thrown instanceof DeliveryError
          ? thrown
          : new DeliveryError(`unexpected error: ${describe(thrown)}`, { retryable: false });
      const fail = (message: string): DeliveryResult => ({
        ...base,
        ok: false,
        attempts: attempt,
        error: message,
      });

      if (!error.retryable || attempt > options.retries) return fail(error.message);
      if (error.retryAfterMs !== undefined && error.retryAfterMs > MAX_RETRY_AFTER_MS) {
        const seconds = String(Math.ceil(error.retryAfterMs / 1000));
        return fail(`${error.message} (server asked to retry after ${seconds}s, over the limit)`);
      }
      const delay = error.retryAfterMs ?? backoffDelay(attempt, options.random);
      options.debug(
        `${job.id}: attempt ${String(attempt)} failed (${error.message}); retrying in ${String(delay)}ms`,
      );
      await options.sleep(delay);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

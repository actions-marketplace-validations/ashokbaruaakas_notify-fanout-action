import { describe, expect, it, vi } from 'vitest';

import { DeliveryError } from '../providers/types.js';
import type { SendResult } from '../providers/types.js';
import type { DeliveryJob, EngineOptions } from './deliver.js';
import { backoffDelay, deliverAll, MAX_RETRY_AFTER_MS } from './deliver.js';
import { shouldFail } from './policy.js';

function options(overrides: Partial<EngineOptions> = {}): EngineOptions {
  return {
    concurrency: 5,
    retries: 3,
    timeoutMs: 1000,
    fetch: vi.fn<typeof fetch>(),
    sleep: vi.fn(() => Promise.resolve()),
    random: () => 0.5,
    debug: vi.fn(),
    ...overrides,
  };
}

/** A job whose attempts throw the given errors in order, then succeed. */
function job(id: string, ...failures: Error[]): DeliveryJob & { send: ReturnType<typeof vi.fn> } {
  let call = 0;
  return {
    id,
    provider: 'fake',
    send: vi.fn((): Promise<SendResult> => {
      const failure = failures[call++];
      return failure === undefined
        ? Promise.resolve({ messageId: `${id}-msg` })
        : Promise.reject(failure);
    }),
  };
}

const retryable = (message = 'HTTP 503') => new DeliveryError(message, { retryable: true });
const fatal = (message = 'HTTP 401') => new DeliveryError(message, { retryable: false });

describe('deliverAll', () => {
  it('delivers every job and keeps the input order', async () => {
    const results = await deliverAll([job('a'), job('b'), job('c')], options());
    expect(results).toEqual([
      { id: 'a', provider: 'fake', ok: true, attempts: 1, messageId: 'a-msg' },
      { id: 'b', provider: 'fake', ok: true, attempts: 1, messageId: 'b-msg' },
      { id: 'c', provider: 'fake', ok: true, attempts: 1, messageId: 'c-msg' },
    ]);
  });

  it('keeps targets independent when one fails', async () => {
    const results = await deliverAll(
      [job('a'), job('b', fatal('bad token')), job('c', new Error('bug')), job('d')],
      options(),
    );
    expect(results.map((r) => [r.id, r.ok, r.error])).toEqual([
      ['a', true, undefined],
      ['b', false, 'bad token'],
      ['c', false, 'unexpected error: bug'],
      ['d', true, undefined],
    ]);
  });

  it('never runs more than `concurrency` sends at once', async () => {
    let active = 0;
    let peak = 0;
    const jobs = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      provider: 'fake',
      send: async (): Promise<SendResult> => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return {};
      },
    }));
    const results = await deliverAll(jobs, options({ concurrency: 3 }));
    expect(peak).toBe(3);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('retries retryable errors with backoff, then succeeds', async () => {
    const opts = options();
    const flaky = job('a', retryable(), retryable());
    const [result] = await deliverAll([flaky], opts);
    expect(result).toMatchObject({ ok: true, attempts: 3 });
    expect(opts.sleep).toHaveBeenNthCalledWith(1, backoffDelay(1, opts.random));
    expect(opts.sleep).toHaveBeenNthCalledWith(2, backoffDelay(2, opts.random));
    expect(flaky.send.mock.calls.map(([ctx]) => (ctx as { attempt: number }).attempt)).toEqual([
      1, 2, 3,
    ]);
  });

  it('gives up after `retries` retries', async () => {
    const [result] = await deliverAll(
      [job('a', retryable(), retryable(), retryable())],
      options({ retries: 2 }),
    );
    expect(result).toMatchObject({ ok: false, attempts: 3, error: 'HTTP 503' });
  });

  it('does not retry non-retryable errors', async () => {
    const opts = options();
    const [result] = await deliverAll([job('a', fatal())], opts);
    expect(result).toMatchObject({ ok: false, attempts: 1, error: 'HTTP 401' });
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it('waits exactly as long as the server asks', async () => {
    const opts = options();
    const limited = new DeliveryError('HTTP 429', { retryable: true, retryAfterMs: 7000 });
    const [result] = await deliverAll([job('a', limited)], opts);
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(opts.sleep).toHaveBeenCalledWith(7000);
  });

  it('fails instead of waiting longer than the retry-after limit', async () => {
    const opts = options();
    const limited = new DeliveryError('HTTP 429', {
      retryable: true,
      retryAfterMs: MAX_RETRY_AFTER_MS + 1,
    });
    const [result] = await deliverAll([job('a', limited)], opts);
    expect(result).toMatchObject({ ok: false, attempts: 1 });
    expect(result?.error).toMatch(/^HTTP 429 \(server asked to retry after 61s, over the limit\)$/);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it('passes a timeout signal, the timeout and fetch to each attempt', async () => {
    const opts = options({ timeoutMs: 2500 });
    const recorded = job('a');
    await deliverAll([recorded], opts);
    const ctx = recorded.send.mock.calls[0]?.[0] as {
      signal: AbortSignal;
      timeoutMs: number;
      fetch: unknown;
    };
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(ctx.timeoutMs).toBe(2500);
    expect(ctx.fetch).toBe(opts.fetch);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially with 50–100% jitter and a cap', () => {
    expect(backoffDelay(1, () => 0)).toBe(500);
    expect(backoffDelay(1, () => 0.999999)).toBe(1000);
    expect(backoffDelay(3, () => 0)).toBe(2000);
    expect(backoffDelay(20, () => 0.999999)).toBe(30_000);
  });
});

describe('shouldFail', () => {
  const ok = { id: 'a', provider: 'p', ok: true, attempts: 1 };
  const bad = { id: 'b', provider: 'p', ok: false, attempts: 1 };

  it.each([
    ['any', [ok, ok], false],
    ['any', [ok, bad], true],
    ['all', [ok, bad], false],
    ['all', [bad, bad], true],
    ['none', [bad, bad], false],
  ] as const)('fail-on %s with %j', (failOn, results, expected) => {
    expect(shouldFail(results, failOn)).toBe(expected);
  });
});

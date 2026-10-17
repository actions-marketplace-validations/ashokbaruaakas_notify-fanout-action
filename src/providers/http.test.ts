import { describe, expect, it, vi } from 'vitest';

import { httpRequest, httpStatusError, parseRetryAfter } from './http.js';
import { DeliveryError } from './types.js';
import type { SendContext } from './types.js';

const URL_WITH_TOKEN = 'https://api.test/bot123:SECRET/send';

function context(fetchImpl: typeof fetch): SendContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 15_000,
    attempt: 1,
    fetch: fetchImpl,
    debug: vi.fn(),
    state: new Map(),
  };
}

async function errorOf(promise: Promise<unknown>): Promise<DeliveryError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DeliveryError) return error;
    throw error;
  }
  throw new Error('expected a DeliveryError');
}

describe('httpRequest', () => {
  it('passes the request and signal to fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response('ok')));
    const ctx = context(fetchMock);
    await httpRequest(ctx, {
      method: 'POST',
      url: URL_WITH_TOKEN,
      headers: { a: 'b' },
      body: '{}',
    });
    expect(fetchMock).toHaveBeenCalledWith(URL_WITH_TOKEN, {
      method: 'POST',
      headers: { a: 'b' },
      body: '{}',
      signal: ctx.signal,
    });
  });

  it('turns network errors into retryable errors without the URL', async () => {
    const cause = Object.assign(new Error(`connect failed ${URL_WITH_TOKEN}`), {
      code: 'ECONNREFUSED',
    });
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError('fetch failed', { cause })),
    );
    const error = await errorOf(
      httpRequest(context(fetchMock), { method: 'GET', url: URL_WITH_TOKEN }),
    );
    expect(error).toMatchObject({ message: 'network error (ECONNREFUSED)', retryable: true });
  });

  it('turns timeouts into retryable errors', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    );
    const error = await errorOf(
      httpRequest(context(fetchMock), { method: 'GET', url: URL_WITH_TOKEN }),
    );
    expect(error).toMatchObject({ message: 'request timed out after 15s', retryable: true });
  });
});

describe('httpStatusError', () => {
  it.each([
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [429, true],
    [500, true],
    [502, true],
  ])('HTTP %i retryable: %s', (status, retryable) => {
    expect(httpStatusError(new Response('', { status }), 'detail')).toMatchObject({
      message: `HTTP ${String(status)}: detail`,
      retryable,
    });
  });

  it('honors Retry-After only for retryable statuses', () => {
    const headers = { 'retry-after': '12' };
    expect(httpStatusError(new Response('', { status: 429, headers })).retryAfterMs).toBe(12_000);
    expect(
      httpStatusError(new Response('', { status: 400, headers })).retryAfterMs,
    ).toBeUndefined();
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('5', now)).toBe(5000);
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Wed, 31 Dec 2025 00:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

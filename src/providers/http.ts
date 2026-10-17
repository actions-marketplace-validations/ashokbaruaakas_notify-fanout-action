import { DeliveryError } from './types.js';
import type { SendContext } from './types.js';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Sends a request with the attempt's timeout. Network failures and timeouts
 * become retryable `DeliveryError`s. Messages never include the URL, because
 * some providers put credentials in it.
 */
export async function httpRequest(context: SendContext, request: HttpRequest): Promise<Response> {
  try {
    return await context.fetch(request.url, {
      method: request.method,
      ...(request.headers ? { headers: request.headers } : {}),
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: context.signal,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      const seconds = String(Math.round(context.timeoutMs / 1000));
      throw new DeliveryError(`request timed out after ${seconds}s`, { retryable: true });
    }
    const code = error instanceof Error ? errorCode(error.cause) : undefined;
    throw new DeliveryError(code ? `network error (${code})` : 'network error', {
      retryable: true,
    });
  }
}

function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  return typeof cause.code === 'string' && /^[A-Z0-9_]+$/.test(cause.code) ? cause.code : undefined;
}

/**
 * The error for a non-2xx response: 429 and 5xx are retryable (honoring
 * Retry-After), every other status is not.
 */
export function httpStatusError(
  response: Response,
  detail = '',
  retryAfterMs: number | undefined = parseRetryAfter(response.headers.get('retry-after')),
): DeliveryError {
  const { status } = response;
  const message = `HTTP ${String(status)}${detail ? `: ${detail}` : ''}`;
  const retryable = status === 429 || status >= 500;
  return new DeliveryError(message, {
    retryable,
    retryAfterMs: retryable ? retryAfterMs : undefined,
  });
}

/** Parses a Retry-After header (delay in seconds, or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

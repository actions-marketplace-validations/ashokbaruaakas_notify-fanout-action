import type { Message } from '../message/model.js';

export interface SendContext {
  /** Aborts when this attempt's timeout elapses. Pass it to every request. */
  signal: AbortSignal;
  timeoutMs: number;
  /** 1 for the first attempt. */
  attempt: number;
  fetch: typeof fetch;
  debug: (message: string) => void;
  /**
   * Kept across attempts for the same target, so a send made of several
   * requests can resume after a retry instead of repeating what succeeded.
   */
  state: Map<string, unknown>;
}

export interface SendResult {
  messageId?: string;
}

/**
 * One messaging platform. `render` must be pure (no network) so it can be
 * unit tested and used for dry runs; `send` does the network part only.
 */
export interface Provider<Config, Rendered> {
  id: string;
  /** Validates the target's provider options. Throws `ConfigError` with a clear message. */
  validate(raw: unknown): Config;
  /** Values to mask in all output. */
  secrets(config: Config): string[];
  /** Escapes a variable value for the native format, used when a target's format is `raw`. */
  escapeRaw(value: string, config: Config): string;
  render(message: Message, config: Config): Rendered;
  send(rendered: Rendered, config: Config, context: SendContext): Promise<SendResult>;
}

/** A failed delivery attempt. The engine retries it only when `retryable` is set. */
export class DeliveryError extends Error {
  override name = 'DeliveryError';
  readonly retryable: boolean;
  /** Server-requested wait before retrying, in milliseconds. */
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: { retryable: boolean; retryAfterMs?: number | undefined }) {
    super(message);
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

import { httpStatusError, parseRetryAfter } from '../http.js';
import { DeliveryError } from '../types.js';

/** The JSON body of a failed Bot API call. */
export interface ApiError {
  ok: false;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

/** Hints for errors users can fix, matched against Telegram's description. */
const HINTS: [RegExp, string][] = [
  [/chat not found/i, 'check chat_id, and that the bot has been added to the chat'],
  [/message thread not found|topic/i, 'check topic_id, and that the chat has topics enabled'],
  [/bot was blocked by the user/i, 'the user blocked the bot; ask them to unblock it'],
  [/bot was kicked|bot is not a member/i, 'add the bot to the chat again'],
  [/not enough rights|have no rights/i, 'give the bot permission to post in this chat'],
  [/can't parse entities/i, 'the formatting is invalid; check raw bodies against parse_mode'],
  [/message to edit not found/i, 'check edit_message_id'],
  [/message text is empty/i, 'the message is empty after rendering'],
  [/message is too long/i, 'enable split, or shorten the message'],
];

/**
 * Turns a failed Bot API response into a clear `DeliveryError`. 429 and 5xx
 * are retryable, honoring `parameters.retry_after`; everything else is not.
 */
export function apiError(response: Response, body: unknown): DeliveryError {
  if (!isApiError(body)) return httpStatusError(response);

  const status = body.error_code ?? response.status;
  const description = body.description ?? `HTTP ${String(status)}`;
  const retryAfter = body.parameters?.retry_after;
  const retryAfterMs =
    typeof retryAfter === 'number'
      ? retryAfter * 1000
      : parseRetryAfter(response.headers.get('retry-after'));

  if (status === 429 || status >= 500) {
    return new DeliveryError(`Telegram ${description}`, { retryable: true, retryAfterMs });
  }

  let hint: string | undefined;
  if (status === 401) hint = 'the bot token is invalid or was revoked';
  else if (typeof body.parameters?.migrate_to_chat_id === 'number') {
    hint = `the group is now a supergroup; use chat_id ${String(body.parameters.migrate_to_chat_id)}`;
  } else {
    hint = HINTS.find(([pattern]) => pattern.test(description))?.[1];
  }
  return new DeliveryError(`Telegram ${description}${hint ? ` (${hint})` : ''}`, {
    retryable: false,
  });
}

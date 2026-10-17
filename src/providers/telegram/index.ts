import { httpRequest } from '../http.js';
import type { Provider } from '../types.js';
import { validateConfig } from './config.js';
import type { TelegramConfig } from './config.js';
import { apiError } from './errors.js';
import { escapeFor, isButtonUrl, messageRuns } from './format.js';
import type { Run } from './runs.js';
import { serialize, splitRuns } from './runs.js';

export const API_URL = 'https://api.telegram.org';
/** sendMessage and editMessageText accept 1-4096 characters after entity parsing. */
export const MESSAGE_LIMIT = 4096;
const BUTTONS_PER_ROW = 2;

export interface TelegramRendered {
  method: 'sendMessage' | 'editMessageText';
  /** One request body per message chunk, sent in order. */
  requests: Record<string, unknown>[];
}

const PARSE_MODE = { html: 'HTML', markdownv2: 'MarkdownV2', none: undefined } as const;

/** Picks the chunks to send. Edits, and sends with `split: false`, are cut to one chunk. */
function chunk(runs: Run[], config: TelegramConfig): string[] {
  const single = !config.split || config.editMessageId !== undefined;
  if (!single) return splitRuns(runs, MESSAGE_LIMIT).map(serialize);
  const [first, ...rest] = splitRuns(runs, MESSAGE_LIMIT - 1);
  if (!first) return [];
  const ellipsis: Run = { text: '…', marks: [], escape: (text) => text };
  return [serialize(rest.length > 0 ? [...first, ellipsis] : first)];
}

export const telegram: Provider<TelegramConfig, TelegramRendered> = {
  id: 'telegram',
  validate: validateConfig,
  secrets: (config) => [config.token],
  escapeRaw: (value, config) => escapeFor(config.parseMode)(value),

  render(message, config) {
    const texts = chunk(messageRuns(message, config.parseMode), config);
    if (texts.length === 0) {
      throw new Error('nothing to send: the title, message and fields are all empty');
    }

    const buttons = message.links
      .filter((link) => isButtonUrl(link.url))
      .map((link) => ({ text: link.label, url: link.url }));
    const rows = [];
    for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
      rows.push(buttons.slice(i, i + BUTTONS_PER_ROW));
    }
    const parseMode = PARSE_MODE[config.parseMode];
    const common = {
      chat_id: config.chatId,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(config.disableLinkPreview ? { link_preview_options: { is_disabled: true } } : {}),
    };
    const keyboard = rows.length > 0 ? { reply_markup: { inline_keyboard: rows } } : {};

    if (config.editMessageId !== undefined) {
      return {
        method: 'editMessageText',
        requests: [{ ...common, message_id: config.editMessageId, text: texts[0], ...keyboard }],
      };
    }
    return {
      method: 'sendMessage',
      requests: texts.map((text, i) => ({
        ...common,
        ...(config.topicId === undefined ? {} : { message_thread_id: config.topicId }),
        text,
        ...(config.silent ? { disable_notification: true } : {}),
        // Only the first chunk replies; only the last carries the buttons.
        ...(i === 0 && config.replyToMessageId !== undefined
          ? {
              reply_parameters: {
                message_id: config.replyToMessageId,
                allow_sending_without_reply: true,
              },
            }
          : {}),
        ...(i === texts.length - 1 ? keyboard : {}),
      })),
    };
  },

  async send(rendered, config, context) {
    // Chunks already delivered by an earlier attempt are not sent again.
    let sent = (context.state.get('sent') as number | undefined) ?? 0;
    let firstId = context.state.get('firstMessageId') as string | undefined;

    for (const request of rendered.requests.slice(sent)) {
      const response = await httpRequest(context, {
        method: 'POST',
        url: `${API_URL}/bot${config.token}/${rendered.method}`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = await response.json().catch((): unknown => undefined);

      if (!response.ok) {
        const error = apiError(response, body);
        // Editing to identical content is not a failure: the message already says this.
        if (
          rendered.method === 'editMessageText' &&
          /message is not modified/i.test(error.message)
        ) {
          return { messageId: String(config.editMessageId) };
        }
        throw error;
      }

      const messageId = (body as { result?: { message_id?: unknown } } | undefined)?.result
        ?.message_id;
      firstId ??=
        rendered.method === 'editMessageText'
          ? String(config.editMessageId)
          : typeof messageId === 'number'
            ? String(messageId)
            : undefined;
      context.state.set('sent', ++sent);
      if (firstId !== undefined) context.state.set('firstMessageId', firstId);
      if (rendered.requests.length > 1) {
        context.debug(`telegram: sent chunk ${String(sent)}/${String(rendered.requests.length)}`);
      }
    }
    return firstId === undefined ? {} : { messageId: firstId };
  },
};

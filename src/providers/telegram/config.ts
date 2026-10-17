import { ConfigError, ObjectReader } from '../../config/reader.js';
import { PARSE_MODES } from './format.js';
import type { ParseMode } from './format.js';

export interface TelegramConfig {
  token: string;
  chatId: string;
  topicId: number | undefined;
  parseMode: ParseMode;
  silent: boolean;
  disableLinkPreview: boolean;
  replyToMessageId: number | undefined;
  editMessageId: number | undefined;
  split: boolean;
}

const TOKEN = /^\d+:[A-Za-z0-9_-]+$/;
const CHAT_ID = /^(-?\d+|@[A-Za-z][A-Za-z0-9_]{3,})$/;
const MAX_ID = Number.MAX_SAFE_INTEGER;

export function validateConfig(raw: unknown): TelegramConfig {
  const reader = ObjectReader.from(raw, 'Telegram options');
  const token = reader.requiredString('token').trim();
  // Never echo the value: it is a secret.
  if (!TOKEN.test(token)) throw new ConfigError('token does not look like a Telegram bot token');
  const chatId = reader.requiredString('chat_id').trim();
  if (!CHAT_ID.test(chatId)) {
    throw new ConfigError('chat_id must be a numeric chat ID or an @channel username');
  }
  const config: TelegramConfig = {
    token,
    chatId,
    topicId: reader.optionalInteger('topic_id', 1, MAX_ID),
    parseMode: reader.optionalEnum('parse_mode', PARSE_MODES) ?? 'html',
    silent: reader.optionalBoolean('silent') ?? false,
    disableLinkPreview: reader.optionalBoolean('disable_link_preview') ?? false,
    replyToMessageId: reader.optionalInteger('reply_to_message_id', 1, MAX_ID),
    editMessageId: reader.optionalInteger('edit_message_id', 1, MAX_ID),
    split: reader.optionalBoolean('split') ?? true,
  };
  reader.assertNoUnknownKeys();
  return config;
}

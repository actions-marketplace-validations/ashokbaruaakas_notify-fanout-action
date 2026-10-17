import { describe, expect, it } from 'vitest';

import { validateConfig } from './config.js';

const TOKEN = '123456:AA-bb_CC';

describe('validateConfig', () => {
  it('applies defaults', () => {
    expect(validateConfig({ token: TOKEN, chat_id: -1001234567890 })).toEqual({
      token: TOKEN,
      chatId: '-1001234567890',
      topicId: undefined,
      parseMode: 'html',
      silent: false,
      disableLinkPreview: false,
      replyToMessageId: undefined,
      editMessageId: undefined,
      split: true,
    });
  });

  it('reads every option, accepting numeric strings from step outputs', () => {
    expect(
      validateConfig({
        token: TOKEN,
        chat_id: '@my_channel',
        topic_id: '5',
        parse_mode: 'MarkdownV2',
        silent: true,
        disable_link_preview: 'true',
        reply_to_message_id: 10,
        edit_message_id: '42',
        split: false,
      }),
    ).toMatchObject({
      chatId: '@my_channel',
      topicId: 5,
      parseMode: 'markdownv2',
      silent: true,
      disableLinkPreview: true,
      replyToMessageId: 10,
      editMessageId: 42,
      split: false,
    });
  });

  it('treats a blank edit_message_id as unset', () => {
    expect(
      validateConfig({ token: TOKEN, chat_id: '1', edit_message_id: '' }).editMessageId,
    ).toBeUndefined();
  });

  it.each([
    [{ chat_id: '1' }, 'token is required'],
    [{ token: 'not-a-token', chat_id: '1' }, 'token does not look like a Telegram bot token'],
    [{ token: TOKEN }, 'chat_id is required'],
    [
      { token: TOKEN, chat_id: 'general' },
      'chat_id must be a numeric chat ID or an @channel username',
    ],
    [{ token: TOKEN, chat_id: '1', topic_id: 0 }, 'topic_id must be an integer from 1'],
    [
      { token: TOKEN, chat_id: '1', parse_mode: 'markdown' },
      'parse_mode must be one of: html, markdownv2, none',
    ],
    [{ token: TOKEN, chat_id: '1', silence: true }, 'unknown option(s): "silence"'],
  ])('rejects %j', (raw, error) => {
    expect(() => validateConfig(raw)).toThrow(error);
  });

  it('never echoes a malformed token', () => {
    expect(() => validateConfig({ token: 'leaky secret value', chat_id: '1' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('leaky') as unknown }),
    );
  });
});

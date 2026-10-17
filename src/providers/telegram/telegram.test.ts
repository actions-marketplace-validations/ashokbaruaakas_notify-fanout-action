import { describe, expect, it, vi } from 'vitest';

import type { Message } from '../../message/model.js';
import type { SendContext } from '../types.js';
import { DeliveryError } from '../types.js';
import type { TelegramConfig } from './config.js';
import { validateConfig } from './config.js';
import { API_URL, MESSAGE_LIMIT, telegram } from './index.js';
import type { TelegramRendered } from './index.js';

const TOKEN = '123456:SECRET-token_value';
const config = (options: Record<string, unknown> = {}): TelegramConfig =>
  validateConfig({ token: TOKEN, chat_id: '-100200300', ...options });

const hostile = 'PR <b>x</b> & [y](z) *a_b* `c` 1.5! #tag (q) {r} >s ~t |u| -v +w =x \\';
const message = (overrides: Partial<Message> = {}): Message => ({
  title: `✅ ${hostile}`,
  body: '',
  format: 'text',
  status: 'success',
  fields: [
    { name: 'Branch', value: 'feature/snake_case', short: true },
    { name: 'Commit', value: hostile, short: false },
  ],
  links: [
    { label: 'View run', url: 'https://github.com/o/r/actions/runs/1' },
    { label: 'View PR', url: 'https://github.com/o/r/pull/7' },
    { label: 'Docs', url: 'https://docs.test/a_(b)' },
    { label: 'Local', url: 'file:///etc/hosts' },
  ],
  ...overrides,
});

const markdownBody = `**Build** _failed_ on \`feat_x\` — [details](https://x.test/a_(b))
\`\`\`sh
npm test && echo "<done>"
\`\`\`
Escaped: \\*not bold\\* and 1.5 > 1`;

describe('render', () => {
  for (const parseMode of ['html', 'markdownv2', 'none'] as const) {
    it(`renders every body format with parse_mode ${parseMode}`, async () => {
      const cfg = config({ parse_mode: parseMode });
      const rendered = {
        text: telegram.render(message({ body: `Body: ${hostile}` }), cfg),
        markdown: telegram.render(message({ body: markdownBody, format: 'markdown' }), cfg),
        raw: telegram.render(
          message({
            body:
              parseMode === 'html'
                ? '<u>native</u> <tg-spoiler>html</tg-spoiler>'
                : parseMode === 'markdownv2'
                  ? '__native__ ||markdown||'
                  : 'plain *raw*',
            format: 'raw',
          }),
          cfg,
        ),
      };
      await expect(JSON.stringify(rendered, null, 2)).toMatchFileSnapshot(
        `../../../test/golden/telegram-${parseMode}.json`,
      );
    });
  }

  it('applies target options to the request', () => {
    const rendered = telegram.render(
      message({ links: [] }),
      config({ topic_id: 5, silent: true, disable_link_preview: true, reply_to_message_id: 9 }),
    );
    expect(rendered.method).toBe('sendMessage');
    expect(rendered.requests[0]).toMatchObject({
      chat_id: '-100200300',
      message_thread_id: 5,
      parse_mode: 'HTML',
      disable_notification: true,
      link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: 9, allow_sending_without_reply: true },
    });
    expect(rendered.requests[0]).not.toHaveProperty('reply_markup');
  });

  it('lays out link buttons two per row and lists unusable URLs as text', () => {
    const [request] = telegram.render(message(), config()).requests;
    expect(request?.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: 'View run', url: 'https://github.com/o/r/actions/runs/1' },
          { text: 'View PR', url: 'https://github.com/o/r/pull/7' },
        ],
        [{ text: 'Docs', url: 'https://docs.test/a_(b)' }],
      ],
    });
    expect(request?.text).toContain('Local: file:///etc/hosts');
  });

  it('splits long messages; only the first replies and only the last has buttons', () => {
    const body = Array.from({ length: 300 }, (_, i) => `Line ${String(i)}: ${'x'.repeat(40)}`).join(
      '\n',
    );
    const { requests } = telegram.render(message({ body }), config({ reply_to_message_id: 3 }));
    expect(requests.length).toBeGreaterThan(2);
    for (const request of requests) {
      const visible = String(request.text)
        .replace(/<[^>]+>/g, '')
        .replace(/&(lt|gt|amp);/g, '_');
      expect(visible.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    }
    expect(requests.map((r) => 'reply_parameters' in r)).toEqual(requests.map((_, i) => i === 0));
    expect(requests.map((r) => 'reply_markup' in r)).toEqual(
      requests.map((_, i) => i === requests.length - 1),
    );
  });

  it('cuts to one message with an ellipsis when split is off or when editing', () => {
    const body = 'word '.repeat(2000);
    for (const options of [{ split: false }, { edit_message_id: 77 }]) {
      const { requests, method } = telegram.render(
        message({ body, fields: [], links: [] }),
        config(options),
      );
      expect(requests).toHaveLength(1);
      expect(String(requests[0]?.text).endsWith('…')).toBe(true);
      expect(method).toBe('edit_message_id' in options ? 'editMessageText' : 'sendMessage');
    }
  });

  it('edits in place with editMessageText', () => {
    const rendered = telegram.render(
      message({ links: [] }),
      config({ edit_message_id: 77, topic_id: 5 }),
    );
    expect(rendered.method).toBe('editMessageText');
    expect(rendered.requests[0]).toMatchObject({ chat_id: '-100200300', message_id: 77 });
    expect(rendered.requests[0]).not.toHaveProperty('message_thread_id');
  });

  it('refuses to send an empty message', () => {
    expect(() => telegram.render(message({ title: '', fields: [], links: [] }), config())).toThrow(
      'nothing to send',
    );
  });

  it('escapes raw-mode variable values for the parse mode', () => {
    expect(telegram.escapeRaw('<a> & b', config())).toBe('&lt;a&gt; &amp; b');
    expect(telegram.escapeRaw('1.5 *x*', config({ parse_mode: 'markdownv2' }))).toBe(
      '1\\.5 \\*x\\*',
    );
    expect(telegram.escapeRaw('<a>', config({ parse_mode: 'none' }))).toBe('<a>');
  });
});

const textOf = (init?: RequestInit): string | undefined =>
  (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { text?: string }).text;

function context(fetchMock: typeof fetch, state = new Map<string, unknown>()): SendContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 1000,
    attempt: 1,
    fetch: fetchMock,
    debug: vi.fn(),
    state,
  };
}

const ok = (messageId: number) => Response.json({ ok: true, result: { message_id: messageId } });
const fail = (status: number, description: string, parameters?: object) =>
  Response.json({ ok: false, error_code: status, description, parameters }, { status });

function queue(...responses: Response[]) {
  return vi.fn<typeof fetch>(() => Promise.resolve(responses.shift() ?? ok(999)));
}

async function sendError(rendered: TelegramRendered, cfg: TelegramConfig, response: Response) {
  try {
    await telegram.send(rendered, cfg, context(queue(response)));
  } catch (error) {
    if (error instanceof DeliveryError) return error;
    throw error;
  }
  throw new Error('expected send to fail');
}

describe('send', () => {
  const rendered: TelegramRendered = {
    method: 'sendMessage',
    requests: [
      { chat_id: '1', text: 'one' },
      { chat_id: '1', text: 'two' },
      { chat_id: '1', text: 'three' },
    ],
  };

  it('posts each chunk in order and returns the first message id', async () => {
    const fetchMock = queue(ok(10), ok(11), ok(12));
    await expect(telegram.send(rendered, config(), context(fetchMock))).resolves.toEqual({
      messageId: '10',
    });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, textOf(init)])).toEqual([
      [`${API_URL}/bot${TOKEN}/sendMessage`, 'one'],
      [`${API_URL}/bot${TOKEN}/sendMessage`, 'two'],
      [`${API_URL}/bot${TOKEN}/sendMessage`, 'three'],
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('resumes after a retry without resending delivered chunks', async () => {
    const state = new Map<string, unknown>();
    const first = queue(ok(10), fail(429, 'Too Many Requests: retry after 3', { retry_after: 3 }));
    const error = await telegram
      .send(rendered, config(), context(first, state))
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ retryable: true, retryAfterMs: 3000 });

    const second = queue(ok(11), ok(12));
    await expect(telegram.send(rendered, config(), context(second, state))).resolves.toEqual({
      messageId: '10',
    });
    expect(second.mock.calls.map(([, init]) => textOf(init))).toEqual(['two', 'three']);
  });

  it('treats editing to identical content as success', async () => {
    const edit: TelegramRendered = {
      method: 'editMessageText',
      requests: [{ chat_id: '1', message_id: 77, text: 'x' }],
    };
    const fetchMock = queue(
      fail(
        400,
        'Bad Request: message is not modified: specified new message content and reply markup are exactly the same',
      ),
    );
    await expect(
      telegram.send(edit, config({ edit_message_id: 77 }), context(fetchMock)),
    ).resolves.toEqual({
      messageId: '77',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_URL}/bot${TOKEN}/editMessageText`);
  });

  it.each([
    [
      fail(401, 'Unauthorized'),
      'Telegram Unauthorized (the bot token is invalid or was revoked)',
      false,
    ],
    [
      fail(400, 'Bad Request: chat not found'),
      'Bad Request: chat not found (check chat_id, and that the bot',
      false,
    ],
    [
      fail(403, 'Forbidden: bot was kicked from the group chat'),
      '(add the bot to the chat again)',
      false,
    ],
    [fail(400, 'Bad Request: message thread not found'), '(check topic_id', false],
    [
      fail(400, "Bad Request: can't parse entities: unclosed tag"),
      '(the formatting is invalid',
      false,
    ],
    [
      fail(400, 'Bad Request: group chat was upgraded to a supergroup chat', {
        migrate_to_chat_id: -1009876,
      }),
      '(the group is now a supergroup; use chat_id -1009876)',
      false,
    ],
    [fail(502, 'Bad Gateway'), 'Telegram Bad Gateway', true],
    [new Response('<html>proxy error</html>', { status: 503 }), 'HTTP 503', true],
  ])('maps API errors: %#', async (response, message, retryable) => {
    const error = await sendError(rendered, config(), response);
    expect(error.message).toContain(message);
    expect(error.retryable).toBe(retryable);
    expect(error.message).not.toContain(TOKEN);
  });
});

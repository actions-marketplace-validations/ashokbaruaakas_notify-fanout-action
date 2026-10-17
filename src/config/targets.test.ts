import { describe, expect, it, vi } from 'vitest';

import { fakeProvider } from '../../test/fake-provider.js';
import { ProviderRegistry } from '../providers/registry.js';
import type { Provider } from '../providers/types.js';
import { readInputs } from './inputs.js';
import { ObjectReader } from './reader.js';
import { parseTargets } from './targets.js';

// Registered under the Telegram id so these tests stay independent of its option validation.
const telegramStub: Provider<{ token: string; chatId: string }, string> = {
  id: 'telegram',
  validate(raw) {
    const reader = ObjectReader.from(raw, 'options');
    const config = {
      token: reader.requiredString('token'),
      chatId: reader.requiredString('chat_id'),
    };
    reader.assertNoUnknownKeys();
    return config;
  },
  secrets: (config) => [config.token],
  escapeRaw: (value) => value,
  render: () => '',
  send: () => Promise.resolve({}),
};

const registry = new ProviderRegistry().register(fakeProvider).register(telegramStub);

function parse(inputs: Record<string, string>, onSecrets = vi.fn()) {
  return parseTargets(
    readInputs((name) => inputs[name] ?? ''),
    registry,
    onSecrets,
  );
}

describe('parseTargets', () => {
  it('turns the simple-mode inputs into one Telegram target', () => {
    const onSecrets = vi.fn();
    const targets = parse(
      { 'telegram-bot-token': '123:abc', 'telegram-chat-id': '-100' },
      onSecrets,
    );
    expect(targets.map((t) => [t.id, t.provider])).toEqual([['telegram-1', 'telegram']]);
    expect(onSecrets).toHaveBeenCalledWith(['123:abc']);
  });

  it('requires both simple-mode inputs', () => {
    expect(() => parse({ 'telegram-bot-token': '123:abc' })).toThrow(
      'telegram-bot-token and telegram-chat-id must be set together',
    );
  });

  it('requires at least one target', () => {
    expect(() => parse({})).toThrow('No targets configured');
    expect(() => parse({ targets: '[]' })).toThrow('No targets configured');
  });

  it('parses targets with content overrides and provider options', () => {
    const targets = parse({
      targets: `
- id: team
  provider: fake
  token: t1
  channel: general
  title: Hello
  message: "Build {{STATUS}}"
  template_file: tpl/team.md
  format: Markdown
- provider: FAKE
  token: t2
  channel: ops
`,
    });
    expect(targets.map((t) => ({ id: t.id, provider: t.provider, content: t.content }))).toEqual([
      {
        id: 'team',
        provider: 'fake',
        content: {
          title: 'Hello',
          message: 'Build {{STATUS}}',
          templateFile: 'tpl/team.md',
          format: 'markdown',
        },
      },
      {
        id: 'fake-1',
        provider: 'fake',
        content: {
          title: undefined,
          message: undefined,
          templateFile: undefined,
          format: undefined,
        },
      },
    ]);
    expect(targets[1]?.bound.secrets).toEqual(['t2']);
  });

  it('puts the simple-mode target first and generates ids that avoid explicit ones', () => {
    const targets = parse({
      'telegram-bot-token': 'tok',
      'telegram-chat-id': '1',
      targets: `
- { provider: telegram, token: tok, chat_id: "2" }
- { id: telegram-2, provider: telegram, token: tok, chat_id: "3" }
- { provider: telegram, token: tok, chat_id: "4" }
`,
    });
    expect(targets.map((t) => t.id)).toEqual([
      'telegram-1',
      'telegram-3',
      'telegram-2',
      'telegram-4',
    ]);
  });

  it('reports secrets for each target as soon as it is bound', () => {
    const onSecrets = vi.fn();
    expect(() =>
      parse(
        {
          targets: `
- { provider: fake, token: first-secret, channel: a }
- { provider: fake, channel: b }
`,
        },
        onSecrets,
      ),
    ).toThrow('targets[1]: token is required');
    expect(onSecrets).toHaveBeenCalledWith(['first-secret']);
  });

  it.each([
    ['provider: fake', 'targets must be a YAML list'],
    ['- just text', 'targets[0]: each target must be a mapping'],
    ['- { token: x }', 'targets[0]: provider is required'],
    [
      '- { provider: slack, token: x }',
      'targets[0]: unknown provider "slack"; available: fake, telegram',
    ],
    [
      '- { id: a, provider: fake, token: x, channel: c, chanel: d }',
      'targets[0] (a): unknown option(s): "chanel"',
    ],
    [
      '- { id: "bad id", provider: fake, token: x, channel: c }',
      'targets[0] (bad id): id may contain only',
    ],
    [
      '- { provider: fake, token: x, channel: c, format: html }',
      'targets[0]: format must be one of',
    ],
    [
      '- { id: a, provider: fake, token: x, channel: c }\n- { id: a, provider: fake, token: y, channel: c }',
      'Duplicate target id "a"',
    ],
    [Array.from({ length: 51 }, () => '- {}').join('\n'), 'targets has more than 50 entries'],
  ])('rejects %j', (targets, error) => {
    expect(() => parse({ targets })).toThrow(error);
  });
});

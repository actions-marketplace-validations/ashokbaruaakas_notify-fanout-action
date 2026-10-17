import { describe, expect, it } from 'vitest';

import { FAKE_API } from '../test/fake-provider.js';
import { events } from '../test/fixtures/events.js';
import type { EventFixture } from '../test/fixtures/events.js';
import { dependencies, okResponse, recordingIO, scriptedFetch } from '../test/harness.js';
import type { Dependencies } from './main.js';
import { run } from './main.js';
import { STATUSES } from './message/model.js';
import { PRESETS } from './message/presets.js';

const TOKEN = 'tok-123:SECRET_value';
const ONE_TARGET = `- { id: main, provider: fake, token: "${TOKEN}", channel: general }`;

async function runAction(
  inputs: Record<string, string>,
  {
    event = events.workflow_dispatch,
    ...overrides
  }: Partial<Dependencies> & { event?: EventFixture; files?: Record<string, string> } = {},
) {
  const { io, recorded } = recordingIO({ targets: ONE_TARGET, ...inputs });
  const files = { '/event.json': JSON.stringify(event.payload), ...overrides.files };
  const env = {
    ...event.env,
    GITHUB_EVENT_PATH: '/event.json',
    GITHUB_WORKSPACE: '/repo',
    ...overrides.env,
  };
  await run(dependencies(io, { ...overrides, env, files }));
  return recorded;
}

function dryRunOutput(recorded: Awaited<ReturnType<typeof runAction>>): string {
  return recorded.logs
    .filter((l) => l.level === 'info' && l.message.startsWith('Dry run: '))
    .map((l) => l.message)
    .join('\n\n');
}

describe('dry run', () => {
  const presetEvents: Record<(typeof PRESETS)[number], EventFixture> = {
    auto: events.push,
    workflow: events.workflow_dispatch,
    deployment: events.deployment_status,
    release: events.release,
    pull_request: events.pull_request,
    issue: events.issues,
    push: events.push,
    custom: events.push,
  };

  it.each(PRESETS)('renders the %s preset', async (preset) => {
    const recorded = await runAction(
      {
        preset,
        status: 'success',
        'dry-run': 'true',
        ...(preset === 'custom'
          ? { title: 'Custom {{REPOSITORY}}', message: 'Hello from {{BRANCH}}' }
          : {}),
      },
      { event: presetEvents[preset] },
    );
    expect(recorded.failed).toBeUndefined();
    await expect(dryRunOutput(recorded)).toMatchFileSnapshot(`../test/golden/preset-${preset}.txt`);
  });

  it('words every status', async () => {
    const outputs: string[] = [];
    for (const status of [...STATUSES, 'Rolled back']) {
      outputs.push(
        dryRunOutput(await runAction({ preset: 'workflow', status, 'dry-run': 'true' })),
      );
    }
    await expect(outputs.join('\n\n')).toMatchFileSnapshot('../test/golden/statuses.txt');
  });

  it('escapes untrusted values per target format', async () => {
    const recorded = await runAction(
      {
        'dry-run': 'true',
        preset: 'pull_request',
        status: 'failure',
        title: '{{PR_TITLE}}',
        message: '**PR:** {{PR_TITLE}} on `{{BRANCH}}`',
        format: 'markdown',
        targets: `
- { id: markdown, provider: fake, token: other-token-1, channel: md }
- { id: text, provider: fake, token: other-token-1, channel: txt, format: text }
- { id: raw, provider: fake, token: other-token-1, channel: raw, format: raw, message: "<b>{{PR_TITLE}}</b>" }
`,
      },
      { event: events.pull_request },
    );
    await expect(dryRunOutput(recorded)).toMatchFileSnapshot('../test/golden/escaping.txt');
  });

  it('renders template files with {{TITLE}} and {{MESSAGE}}', async () => {
    const recorded = await runAction(
      { 'dry-run': 'true', status: 'success', message: 'all good', 'template-file': 'notify.md' },
      { files: { '/repo/notify.md': '{{TITLE}}\n---\n{{MESSAGE}} ({{COMMIT_SHORT}})\n' } },
    );
    expect(dryRunOutput(recorded)).toContain('✅ CI succeeded\n---\nall good (0123456)');
  });

  it('reports dry-run results without sending anything', async () => {
    const fetchMock = scriptedFetch(okResponse());
    const recorded = await runAction({ 'dry-run': 'true' }, { fetch: fetchMock });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recorded.results()).toEqual([{ id: 'main', provider: 'fake', ok: true, attempts: 0 }]);
  });
});

describe('delivery', () => {
  it('sends to each target and reports message ids', async () => {
    const fetchMock = scriptedFetch(okResponse('m1'));
    const recorded = await runAction({}, { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${FAKE_API}/bot${TOKEN}/send`);
    expect(recorded.results()).toEqual([
      { id: 'main', provider: 'fake', ok: true, attempts: 1, message_id: 'm1' },
    ]);
    expect(recorded.outputs['success-count']).toBe('1');
    expect(recorded.failed).toBeUndefined();
  });

  const twoTargets = `
- { id: good, provider: fake, token: good-token-1, channel: good }
- { id: bad, provider: fake, token: bad-token-22, channel: bad }
`;
  // Fails every request for the "bad" channel.
  const fetchFailingBad = () =>
    scriptedFetch(() => okResponse()).mockImplementation((_url, init) =>
      Promise.resolve(
        typeof init?.body === 'string' && init.body.includes('"channel":"bad"')
          ? new Response('{"description":"chat not found"}', { status: 400 })
          : okResponse(),
      ),
    );

  it('keeps going when one target fails, then fails the step (fail-on: any)', async () => {
    const recorded = await runAction({ targets: twoTargets }, { fetch: fetchFailingBad() });
    expect(recorded.results().map((r) => [r.id, r.ok, r.attempts])).toEqual([
      ['good', true, 1],
      ['bad', false, 1],
    ]);
    expect(recorded.failed).toBe('1 of 2 target(s) failed.');
  });

  it('only warns with fail-on: all when some targets succeed', async () => {
    const recorded = await runAction(
      { targets: twoTargets, 'fail-on': 'all' },
      { fetch: fetchFailingBad() },
    );
    expect(recorded.failed).toBeUndefined();
    expect(recorded.logs).toContainEqual({
      level: 'warning',
      message: '1 of 2 target(s) failed. Not failing the step (fail-on: all).',
    });
  });

  it('never fails with fail-on: none', async () => {
    const fetchMock = scriptedFetch(new Response('', { status: 401 }));
    const recorded = await runAction(
      { targets: twoTargets, 'fail-on': 'none' },
      { fetch: fetchMock },
    );
    expect(recorded.outputs['failure-count']).toBe('2');
    expect(recorded.failed).toBeUndefined();
  });

  it('retries server errors and rate limits', async () => {
    const sleeps: number[] = [];
    const fetchMock = scriptedFetch(
      new Response('', { status: 503 }),
      new Response('', { status: 429, headers: { 'retry-after': '3' } }),
      okResponse(),
    );
    const recorded = await runAction(
      {},
      {
        fetch: fetchMock,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(recorded.results()[0]).toMatchObject({ ok: true, attempts: 3 });
    expect(sleeps).toEqual([750, 3000]);
  });

  it('fails only the target whose template file is missing', async () => {
    const recorded = await runAction({
      'dry-run': 'true',
      targets: `
- { id: a, provider: fake, token: other-token-1, channel: a, template_file: missing.md }
- { id: b, provider: fake, token: other-token-1, channel: b }
`,
    });
    expect(recorded.results()).toEqual([
      {
        id: 'a',
        provider: 'fake',
        ok: false,
        attempts: 0,
        error: 'template file "missing.md" could not be read',
      },
      { id: 'b', provider: 'fake', ok: true, attempts: 0 },
    ]);
  });

  it('writes the job summary only when the runner provides one', async () => {
    expect((await runAction({ 'dry-run': 'true' })).summary).toEqual([]);
    const recorded = await runAction(
      { 'dry-run': 'true' },
      { env: { GITHUB_STEP_SUMMARY: '/summary' } },
    );
    expect(recorded.summary[0]).toContain('<td>main</td><td>fake</td><td>📝 dry run</td>');
  });
});

describe('configuration errors', () => {
  it('fails the step with a clear message', async () => {
    const recorded = await runAction({ targets: '- { provider: fake, channel: x }' });
    expect(recorded.failed).toBe('targets[0]: token is required');
  });

  it('warns once per unknown variable', async () => {
    const recorded = await runAction({
      'dry-run': 'true',
      title: '{{NOPE}}',
      message: '{{NOPE}} {{nope}}',
    });
    expect(recorded.logs.filter((l) => l.level === 'warning').map((l) => l.message)).toEqual([
      'Unknown template variable {{NOPE}} rendered as empty.',
      'Unknown template variable {{nope}} rendered as empty.',
    ]);
  });
});

describe('secrets', () => {
  it('never appear in logs, outputs or the summary, even when echoed back by the API', async () => {
    const echo = `{"description":"Unauthorized: ${FAKE_API}/bot${TOKEN}/send", "token": "${encodeURIComponent(TOKEN)}"}`;
    const recorded = await runAction(
      { debug: 'true', retries: '1', message: 'token is {{NOPE}}' },
      {
        fetch: scriptedFetch(
          new Response(echo, { status: 500 }),
          new Response(echo, { status: 401 }),
        ),
        env: { GITHUB_STEP_SUMMARY: '/summary' },
      },
    );
    expect(recorded.secrets).toContain(TOKEN);
    expect(recorded.results()[0]).toMatchObject({ ok: false, attempts: 2 });
    expect(recorded.everything()).toContain('***');
    expect(recorded.everything()).not.toContain(TOKEN);
    expect(recorded.everything()).not.toContain(encodeURIComponent(TOKEN));
    expect(recorded.everything()).not.toContain('SECRET_value');
  });

  it('masks the simple-mode token before validation can fail', async () => {
    // No Telegram provider is registered yet, so this target is rejected.
    const recorded = await runAction({
      targets: '',
      'telegram-bot-token': TOKEN,
      'telegram-chat-id': '1',
    });
    expect(recorded.secrets).toContain(TOKEN);
    expect(recorded.failed).toBe(
      'telegram-bot-token/telegram-chat-id: unknown provider "telegram"; available: fake',
    );
  });
});

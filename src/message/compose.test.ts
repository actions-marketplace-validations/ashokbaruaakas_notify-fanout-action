import { describe, expect, it, vi } from 'vitest';

import type { ComposeInput } from './compose.js';
import { composeMessage } from './compose.js';
import { resolveStatus } from './model.js';
import type { ContentTemplate } from './presets.js';

const preset: ContentTemplate = {
  title: '{{EMOJI}} Preset title',
  body: 'Preset body for {{BRANCH}}',
  fields: [
    { name: 'Branch', value: '{{BRANCH}}', short: true },
    { name: 'PR', value: '{{PR_TITLE}}', short: false },
  ],
  links: [
    { label: 'Run', url: '{{RUN_URL}}' },
    { label: 'Missing', url: '{{PR_URL}}' },
  ],
};

function compose(overrides: Partial<ComposeInput> = {}) {
  return composeMessage({
    preset,
    status: resolveStatus('success'),
    global: {},
    target: {},
    variables: new Map([
      ['BRANCH', 'feat/a_b'],
      ['RUN_URL', 'https://gh.test/run/1'],
      ['PR_TITLE', ''],
      ['PR_URL', ''],
      ['COMMIT_MESSAGE', 'fix <script> & **stuff**'],
    ]),
    escapeRaw: (v) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    onUnknownVariable: vi.fn(),
    ...overrides,
  });
}

describe('composeMessage', () => {
  it('uses the preset and drops fields and links that render empty', () => {
    expect(compose()).toEqual({
      title: '✅ Preset title',
      body: 'Preset body for feat/a_b',
      format: 'text',
      status: 'success',
      fields: [{ name: 'Branch', value: 'feat/a_b', short: true }],
      links: [{ label: 'Run', url: 'https://gh.test/run/1' }],
    });
  });

  it('lets global inputs override the preset, and targets override global inputs', () => {
    const message = compose({
      global: {
        title: 'Global title',
        message: 'Global message',
        fields: [{ name: 'Only', value: 'field', short: false }],
        links: [{ label: '', url: 'https://x.test' }],
      },
      target: { title: 'Target title' },
    });
    expect(message.title).toBe('Target title');
    expect(message.body).toBe('Global message');
    expect(message.fields).toEqual([{ name: 'Only', value: 'field', short: false }]);
    expect(message.links).toEqual([{ label: 'https://x.test', url: 'https://x.test' }]);
  });

  it('prefers the most specific body source', () => {
    const global = { message: 'global message', template: 'global template: {{MESSAGE}}' };
    expect(compose({ global }).body).toBe('global template: global message');
    expect(compose({ global, target: { message: 'target message' } }).body).toBe('target message');
    expect(compose({ global, target: { template: 'target template: {{MESSAGE}}' } }).body).toBe(
      'target template: global message',
    );
    expect(compose({ global: { template: '[{{MESSAGE}}]' } }).body).toBe(
      '[Preset body for feat/a_b]',
    );
  });

  it('exposes the resolved title and message to templates', () => {
    const message = compose({
      global: { title: '{{STATUS}}: {{BRANCH}}', template: 'T={{TITLE}} M={{MESSAGE}}\n' },
    });
    expect(message.title).toBe('success: feat/a_b');
    expect(message.body).toBe('T=success: feat/a_b M=Preset body for feat/a_b');
  });

  it('escapes variable values for markdown, but not the template or {{MESSAGE}}', () => {
    const message = compose({
      global: {
        format: 'markdown',
        message: '**{{BRANCH}}** {{COMMIT_MESSAGE}}',
        template: '{{MESSAGE}} / {{TITLE}}',
        title: '*{{BRANCH}}*',
      },
    });
    expect(message.title).toBe('*feat/a_b*');
    expect(message.body).toBe('**feat/a\\_b** fix <script> & \\*\\*stuff\\*\\* / \\*feat/a\\_b\\*');
  });

  it('escapes variable values with the provider escaper in raw mode', () => {
    const message = compose({
      target: { format: 'raw', message: '<b>{{COMMIT_MESSAGE}}</b>' },
      global: { format: 'markdown' },
    });
    expect(message.format).toBe('raw');
    expect(message.body).toBe('<b>fix &lt;script> &amp; **stuff**</b>');
  });

  it('collapses whitespace in titles and trims the body', () => {
    const message = compose({ global: { title: '  a \n  b  ', message: '\n  body \n' } });
    expect(message.title).toBe('a b');
    expect(message.body).toBe('body');
  });

  it('reports unknown variables', () => {
    const onUnknownVariable = vi.fn();
    compose({ global: { message: '{{NOPE}}' }, onUnknownVariable });
    expect(onUnknownVariable).toHaveBeenCalledWith('NOPE');
  });

  it('shows custom statuses as given, with the info emoji', () => {
    const message = compose({
      status: resolveStatus('Deployed'),
      global: { title: '{{EMOJI}} {{STATUS}}' },
    });
    expect(message).toMatchObject({ title: 'ℹ️ Deployed', status: 'info' });
  });
});

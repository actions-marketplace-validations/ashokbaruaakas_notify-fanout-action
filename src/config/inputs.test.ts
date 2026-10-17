import { describe, expect, it } from 'vitest';

import { MAX_INPUT_LENGTH, readInputs } from './inputs.js';

const read = (inputs: Record<string, string>) => readInputs((name) => inputs[name] ?? '');

describe('readInputs', () => {
  it('applies defaults when inputs are empty', () => {
    expect(read({})).toEqual({
      status: 'info',
      preset: 'auto',
      title: undefined,
      message: undefined,
      fields: undefined,
      links: undefined,
      templateFile: undefined,
      format: 'text',
      targets: undefined,
      telegramBotToken: undefined,
      telegramChatId: undefined,
      failOn: 'any',
      retries: 3,
      timeoutSeconds: 15,
      concurrency: 5,
      dryRun: false,
      debug: false,
    });
  });

  it('parses enums case-insensitively, integers and booleans', () => {
    expect(
      read({
        preset: 'Release',
        'fail-on': 'NONE',
        retries: '0',
        concurrency: '50',
        'dry-run': 'TRUE',
      }),
    ).toMatchObject({
      preset: 'release',
      failOn: 'none',
      retries: 0,
      concurrency: 50,
      dryRun: true,
    });
  });

  it.each([
    [{ preset: 'nope' }, 'preset must be one of: auto, workflow'],
    [{ format: 'html' }, 'format must be one of: text, markdown, raw'],
    [{ 'fail-on': 'some' }, 'fail-on must be one of: any, all, none'],
    [{ retries: '11' }, 'retries must be an integer from 0 to 10'],
    [{ retries: '1.5' }, 'retries must be an integer from 0 to 10'],
    [{ 'timeout-seconds': '0' }, 'timeout-seconds must be an integer from 1 to 300'],
    [{ concurrency: 'many' }, 'concurrency must be an integer from 1 to 50'],
    [{ debug: 'yes' }, 'debug must be one of: true, false'],
    [{ message: 'x'.repeat(MAX_INPUT_LENGTH + 1) }, 'message is longer than'],
  ])('rejects %j', (inputs, error) => {
    expect(() => read(inputs)).toThrow(error);
  });

  it('parses fields and links from YAML or JSON', () => {
    const inputs = read({
      fields: '- name: Env\n  value: prod\n  short: true\n- { name: Count, value: 3 }',
      links: '[{"label": "Docs", "url": "https://docs.test"}]',
    });
    expect(inputs.fields).toEqual([
      { name: 'Env', value: 'prod', short: true },
      { name: 'Count', value: '3', short: false },
    ]);
    expect(inputs.links).toEqual([{ label: 'Docs', url: 'https://docs.test' }]);
  });

  it.each([
    [{ fields: 'name: x' }, 'fields must be a YAML list'],
    [{ fields: '- name: x' }, 'fields[0]: value is required'],
    [{ fields: '- name: x\n  value: y\n  colour: red' }, 'fields[0]: unknown option(s): "colour"'],
    [{ links: '- just a string' }, 'links[0]: each link must be a mapping'],
    [{ links: '- label: x\n  url: [1]' }, 'links[0]: url must be a string'],
  ])('rejects bad fields/links %j', (inputs, error) => {
    expect(() => read(inputs)).toThrow(error);
  });

  it('reports YAML errors by position without quoting the source', () => {
    let message = '';
    try {
      read({ fields: '- name: x\n  value: "secret-value-123' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^fields: invalid YAML at line \d+, column \d+$/);
    expect(message).not.toContain('secret-value-123');
  });
});

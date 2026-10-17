import { describe, expect, it, vi } from 'vitest';

import { expand } from './template.js';

const variables = new Map([
  ['BRANCH', 'main'],
  ['TITLE', '<b>'],
  ['EMPTY', ''],
]);

describe('expand', () => {
  it('replaces variables, allowing spaces inside the braces', () => {
    const onUnknown = vi.fn();
    expect(
      expand('on {{BRANCH}} / {{ BRANCH }}{{EMPTY}}', variables, { escape: (v) => v, onUnknown }),
    ).toBe('on main / main');
    expect(onUnknown).not.toHaveBeenCalled();
  });

  it('escapes values but not template text', () => {
    const escape = (v: string) => v.replaceAll('<', '&lt;');
    expect(expand('<i>{{TITLE}}</i>', variables, { escape, onUnknown: vi.fn() })).toBe(
      '<i>&lt;b></i>',
    );
  });

  it('inserts preformatted variables unescaped', () => {
    const escape = () => 'ESCAPED';
    expect(
      expand('{{TITLE}}', variables, {
        escape,
        preformatted: new Set(['TITLE']),
        onUnknown: vi.fn(),
      }),
    ).toBe('<b>');
  });

  it('renders unknown variables as empty and reports them', () => {
    const onUnknown = vi.fn();
    expect(expand('a{{NOPE}}b{{constructor}}', variables, { escape: (v) => v, onUnknown })).toBe(
      'ab',
    );
    expect(onUnknown.mock.calls).toEqual([['NOPE'], ['constructor']]);
  });

  it('leaves text that is not a variable alone', () => {
    expect(
      expand('{ {X} } {{a-b}} {"json": 1}', variables, { escape: (v) => v, onUnknown: vi.fn() }),
    ).toBe('{ {X} } {{a-b}} {"json": 1}');
  });
});

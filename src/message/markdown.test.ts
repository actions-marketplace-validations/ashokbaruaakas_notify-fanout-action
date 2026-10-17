import { describe, expect, it } from 'vitest';

import { escapeMarkdown, parseMarkdown } from './markdown.js';

const text = (value: string) => ({ type: 'text', value });

describe('parseMarkdown', () => {
  it('parses plain text as a single text node', () => {
    expect(parseMarkdown('hello\nworld')).toEqual([text('hello\nworld')]);
    expect(parseMarkdown('')).toEqual([]);
  });

  it('parses bold, italic, code and links', () => {
    expect(parseMarkdown('**b** *i* _j_ `c` [l](https://x.test/a?b=1)')).toEqual([
      { type: 'bold', children: [text('b')] },
      text(' '),
      { type: 'italic', children: [text('i')] },
      text(' '),
      { type: 'italic', children: [text('j')] },
      text(' '),
      { type: 'code', value: 'c' },
      text(' '),
      { type: 'link', url: 'https://x.test/a?b=1', children: [text('l')] },
    ]);
  });

  it('nests spans', () => {
    expect(parseMarkdown('**a _b_ [c **d**](u)**')).toEqual([
      {
        type: 'bold',
        children: [
          text('a '),
          { type: 'italic', children: [text('b')] },
          text(' '),
          {
            type: 'link',
            url: 'u',
            children: [text('c '), { type: 'bold', children: [text('d')] }],
          },
        ],
      },
    ]);
  });

  it('allows balanced parentheses in link URLs', () => {
    expect(parseMarkdown('[w](https://en.wikipedia.org/wiki/A_(b)) end')).toEqual([
      { type: 'link', url: 'https://en.wikipedia.org/wiki/A_(b)', children: [text('w')] },
      text(' end'),
    ]);
  });

  it('keeps unmatched or misplaced markers as text', () => {
    expect(parseMarkdown('a ** b')).toEqual([text('a ** b')]);
    expect(parseMarkdown('**open')).toEqual([text('**open')]);
    expect(parseMarkdown('`open')).toEqual([text('`open')]);
    expect(parseMarkdown('[label] (x)')).toEqual([text('[label] (x)')]);
    expect(parseMarkdown('[label]()')).toEqual([text('[label]()')]);
    expect(parseMarkdown('****')).toEqual([text('****')]);
    expect(parseMarkdown('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
  });

  it('does not treat underscores inside words as emphasis', () => {
    expect(parseMarkdown('my_snake_case_name')).toEqual([text('my_snake_case_name')]);
  });

  it('parses fenced code blocks and keeps the surrounding newlines', () => {
    expect(parseMarkdown('before\n```ts\nconst a = 1;\n**not bold**\n```\nafter')).toEqual([
      text('before\n'),
      { type: 'codeblock', language: 'ts', value: 'const a = 1;\n**not bold**' },
      text('\nafter'),
    ]);
    expect(parseMarkdown('```\na\n```\n```\nb\n```')).toEqual([
      { type: 'codeblock', language: '', value: 'a' },
      text('\n'),
      { type: 'codeblock', language: '', value: 'b' },
    ]);
  });

  it('treats an unclosed fence as text', () => {
    expect(parseMarkdown('```\ncode')).toEqual([text('```\ncode')]);
  });

  it('normalizes CRLF line endings', () => {
    expect(parseMarkdown('a\r\nb')).toEqual([text('a\nb')]);
  });
});

describe('escapeMarkdown', () => {
  const nasty = [
    '**not bold**',
    '_not italic_',
    'a `b` c',
    '[x](https://evil.test)',
    'trailing backslash \\',
    'C:\\path\\_file',
    '```\nfence\n```',
    'mix *_`[]()\\ all',
    'feat/my_branch-name',
  ];

  it.each(nasty)('makes %j literal in text', (value) => {
    expect(parseMarkdown(escapeMarkdown(value))).toEqual([text(value)]);
  });

  it.each(nasty)('makes %j literal inside bold, code and link', (value) => {
    const escaped = escapeMarkdown(value);
    expect(parseMarkdown(`**${escaped}**`)).toEqual([{ type: 'bold', children: [text(value)] }]);
    expect(parseMarkdown(`\`${escaped}\``)).toEqual([{ type: 'code', value }]);
    expect(parseMarkdown(`[${escaped}](https://ok.test)`)).toEqual([
      { type: 'link', url: 'https://ok.test', children: [text(value)] },
    ]);
  });

  it('keeps a value literal when used as a link URL', () => {
    expect(parseMarkdown(`[run](${escapeMarkdown('https://x.test/a_(b)')})`)).toEqual([
      { type: 'link', url: 'https://x.test/a_(b)', children: [text('run')] },
    ]);
  });
});

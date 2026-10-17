import { describe, expect, it } from 'vitest';

import { escapeHtml, htmlRuns } from './format.js';
import type { Mark, Run } from './runs.js';
import { serialize, splitRuns, visibleLength } from './runs.js';

const bold: Mark = { open: '<b>', close: '</b>' };
const italic: Mark = { open: '<i>', close: '</i>' };
const run = (text: string, marks: Mark[] = []): Run => ({ text, marks, escape: escapeHtml });

/** Checks a Telegram HTML string has balanced tags, and returns its visible text. */
function checkHtml(html: string): string {
  const stack: string[] = [];
  for (const [, closing, name] of html.matchAll(/<(\/?)([a-z-]+)[^>]*>/g)) {
    if (closing) expect(stack.pop(), `unbalanced </${String(name)}> in ${html}`).toBe(name);
    else stack.push(name ?? '');
  }
  expect(stack, `unclosed tags in ${html}`).toEqual([]);
  return html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('serialize', () => {
  it('opens and closes marks only where they change', () => {
    const shared = [bold];
    expect(
      serialize([run('a', shared), run('b', [...shared, italic]), run('c', shared), run('<d>')]),
    ).toBe('<b>a<i>b</i>c</b>&lt;d&gt;');
  });

  it('keeps separate elements with the same tag separate', () => {
    expect(serialize([run('a', [{ ...bold }]), run('b', [{ ...bold }])])).toBe('<b>a</b><b>b</b>');
  });
});

describe('splitRuns', () => {
  it('keeps short messages whole', () => {
    expect(splitRuns([run('hello')], 10).map(serialize)).toEqual(['hello']);
  });

  it('prefers paragraph breaks, then line breaks, then spaces, dropping the separator', () => {
    expect(splitRuns([run('aaaa bbbb\ncccc\n\ndddd')], 16).map(serialize)).toEqual([
      'aaaa bbbb\ncccc',
      'dddd',
    ]);
    expect(splitRuns([run('aaaa bbbb\ncccc dddd')], 12).map(serialize)).toEqual([
      'aaaa bbbb',
      'cccc dddd',
    ]);
    expect(splitRuns([run('aaaa bbbb cccc')], 10).map(serialize)).toEqual(['aaaa bbbb', 'cccc']);
  });

  it('hard-splits text with no usable break, without splitting surrogate pairs', () => {
    expect(splitRuns([run('abcdefghij')], 4).map(serialize)).toEqual(['abcd', 'efgh', 'ij']);
    expect(splitRuns([run('ab😀cd')], 3).map(serialize)).toEqual(['ab', '😀c', 'd']);
  });

  it('closes marks at a cut and reopens them in the next chunk', () => {
    const shared = [bold];
    expect(splitRuns([run('one two three', shared)], 8).map(serialize)).toEqual([
      '<b>one two</b>',
      '<b>three</b>',
    ]);
  });

  it('drops whitespace-only chunks', () => {
    expect(splitRuns([run('a\n\n\n\n\n\nb')], 3).map(serialize)).toEqual(['a', 'b']);
  });

  it('always yields balanced chunks within the limit that keep all the text', () => {
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const words = ['alpha', 'beta', '<x>', 'a&b', '😀', 'gamma\n', '\n\n', 'delta'];
    for (let trial = 0; trial < 30; trial++) {
      const outer = { ...bold };
      const runs: Run[] = [];
      for (let i = 0; i < 200; i++) {
        const text = Array.from(
          { length: 1 + Math.floor(random() * 4) },
          () => words[Math.floor(random() * words.length)],
        ).join(' ');
        const r = random();
        runs.push(run(text, r < 0.3 ? [outer] : r < 0.5 ? [outer, { ...italic }] : []));
      }
      const limit = 50 + Math.floor(random() * 300);
      const chunks = splitRuns(runs, limit);
      for (const chunk of chunks) expect(visibleLength(chunk)).toBeLessThanOrEqual(limit);
      const visible = chunks.map((chunk) => checkHtml(serialize(chunk)));
      const squash = (s: string) => s.replace(/\s+/g, '');
      expect(squash(visible.join(''))).toBe(squash(runs.map((r) => r.text).join('')));
    }
  });
});

describe('htmlRuns', () => {
  it('reads native HTML, decoding entities and keeping tags as written', () => {
    const runs = htmlRuns(
      '<b>bold &amp; <a href="https://x.test?a=1&amp;b=2">link</a></b> 1 &lt; 2 &#128512;',
    );
    expect(runs.map((r) => r.text)).toEqual(['bold ', '&', ' ', 'link', ' 1 ', '<', ' 2 ', '😀']);
    expect(serialize(runs)).toBe(
      '<b>bold &amp; <a href="https://x.test?a=1&amp;b=2">link</a></b> 1 &lt; 2 😀',
    );
  });

  it('closes unclosed tags and ignores stray closing tags and brackets', () => {
    expect(serialize(htmlRuns('<i>open </b> 3 < 4 & 5'))).toBe('<i>open  3 &lt; 4 &amp; 5</i>');
  });

  it('splits long native HTML without breaking tags', () => {
    const html = `<b>${'word '.repeat(40)}</b><pre><code class="language-ts">${'x\n'.repeat(40)}</code></pre>`;
    for (const chunk of splitRuns(htmlRuns(html), 60)) checkHtml(serialize(chunk));
  });
});

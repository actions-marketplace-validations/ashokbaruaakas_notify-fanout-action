/**
 * The neutral markdown subset shared by all providers: **bold**, *italic* or
 * _italic_, `inline code`, fenced code blocks and [links](url).
 *
 * A backslash before any ASCII punctuation makes it literal, everywhere,
 * including inside code. That lets `escapeMarkdown` make any variable value
 * safe regardless of where the template puts it.
 */
export type MarkdownNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: MarkdownNode[] }
  | { type: 'italic'; children: MarkdownNode[] }
  | { type: 'code'; value: string }
  | { type: 'codeblock'; language: string; value: string }
  | { type: 'link'; url: string; children: MarkdownNode[] };

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const ESCAPED_PUNCTUATION = /\\([!-/:-@[-`{-~])/g;
const SPECIAL = /[\\`*_[\]()]/g;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/;
const FENCE_OPEN = /^```([^`]*)$/;
const FENCE_CLOSE = /^```\s*$/;

export function escapeMarkdown(value: string): string {
  return value.replace(SPECIAL, '\\$&');
}

function unescape(value: string): string {
  return value.replace(ESCAPED_PUNCTUATION, '$1');
}

export function parseMarkdown(source: string): MarkdownNode[] {
  const text = source.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i] ?? '');
    if (!open) continue;
    let close = -1;
    for (let k = i + 1; k < lines.length; k++) {
      if (FENCE_CLOSE.test(lines[k] ?? '')) {
        close = k;
        break;
      }
    }
    // Every later fence line would also need a closing line after it.
    if (close === -1) break;
    nodes.push(...parseInline(text.slice(cursor, lineStarts[i])));
    nodes.push({
      type: 'codeblock',
      language: (open[1] ?? '').trim(),
      value: unescape(lines.slice(i + 1, close).join('\n')),
    });
    cursor = (lineStarts[close] ?? 0) + (lines[close] ?? '').length;
    i = close;
  }
  nodes.push(...parseInline(text.slice(cursor)));
  return mergeText(nodes);
}

type Marker = '**' | '*' | '_' | '[';
interface Delimiter {
  type: 'delimiter';
  marker: Marker;
}
type Item = MarkdownNode | Delimiter;

function parseInline(source: string): MarkdownNode[] {
  const items: Item[] = [];
  // Indices into `items` of delimiters that may still open a span, innermost last.
  const openers: number[] = [];
  let text = '';

  const flushText = (): void => {
    if (text !== '') items.push({ type: 'text', value: text });
    text = '';
  };
  const findOpener = (marker: Marker): number => {
    for (let k = openers.length - 1; k >= 0; k--) {
      const index = openers[k] ?? -1;
      const item = items[index];
      if (item?.type === 'delimiter' && item.marker === marker) return index;
    }
    return -1;
  };
  // Replaces the opener at `index` and everything after it with a single node.
  const close = (index: number, build: (children: MarkdownNode[]) => MarkdownNode): void => {
    const children = finalize(items.splice(index).slice(1));
    items.push(build(children));
    while ((openers.at(-1) ?? -1) >= index) openers.pop();
  };
  const isEmptySpan = (index: number): boolean => index === items.length - 1 && text === '';

  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);

    if (ch === '\\' && PUNCTUATION.test(source.charAt(i + 1))) {
      text += source.charAt(i + 1);
      i += 2;
      continue;
    }

    if (ch === '`') {
      const end = findUnescaped(source, '`', i + 1);
      // Empty spans stay literal, so stray runs like an unclosed ``` remain text.
      if (end === -1 || end === i + 1) {
        text += ch;
        i++;
        continue;
      }
      flushText();
      items.push({ type: 'code', value: unescape(source.slice(i + 1, end)) });
      i = end + 1;
      continue;
    }

    if (ch === '*' || ch === '_') {
      const marker: Marker = ch === '*' && source.charAt(i + 1) === '*' ? '**' : ch;
      const before = source.charAt(i - 1);
      const after = source.charAt(i + marker.length);
      let canOpen = after !== '' && !WHITESPACE.test(after);
      let canClose = before !== '' && !WHITESPACE.test(before);
      if (marker === '_') {
        // snake_case words are not emphasis.
        canOpen &&= !ALPHANUMERIC.test(before);
        canClose &&= !ALPHANUMERIC.test(after);
      }
      const opener = canClose ? findOpener(marker) : -1;
      if (opener !== -1 && !isEmptySpan(opener)) {
        flushText();
        close(opener, (children) => ({ type: marker === '**' ? 'bold' : 'italic', children }));
      } else if (canOpen) {
        flushText();
        openers.push(items.length);
        items.push({ type: 'delimiter', marker });
      } else {
        text += marker;
      }
      i += marker.length;
      continue;
    }

    if (ch === '[') {
      flushText();
      openers.push(items.length);
      items.push({ type: 'delimiter', marker: '[' });
      i++;
      continue;
    }

    if (ch === ']') {
      const opener = findOpener('[');
      const target = opener === -1 ? null : parseLinkTarget(source, i + 1);
      if (target && !isEmptySpan(opener)) {
        flushText();
        close(opener, (children) => ({ type: 'link', url: target.url, children }));
        i = target.end;
        continue;
      }
    }

    text += ch;
    i++;
  }
  flushText();
  return finalize(items);
}

function findUnescaped(source: string, char: string, from: number): number {
  for (let i = from; i < source.length; i++) {
    const ch = source.charAt(i);
    if (ch === '\\' && PUNCTUATION.test(source.charAt(i + 1))) i++;
    else if (ch === char) return i;
  }
  return -1;
}

function parseLinkTarget(source: string, from: number): { url: string; end: number } | null {
  if (source.charAt(from) !== '(') return null;
  for (let i = from + 1; i < source.length; i++) {
    const ch = source.charAt(i);
    if (ch === '\\' && PUNCTUATION.test(source.charAt(i + 1))) i++;
    else if (ch === '\n') return null;
    else if (ch === ')') {
      const url = unescape(source.slice(from + 1, i)).trim();
      return url === '' ? null : { url, end: i + 1 };
    }
  }
  return null;
}

/** Turns unmatched delimiters back into text. */
function finalize(items: Item[]): MarkdownNode[] {
  return mergeText(
    items.map((item) => (item.type === 'delimiter' ? { type: 'text', value: item.marker } : item)),
  );
}

function mergeText(nodes: MarkdownNode[]): MarkdownNode[] {
  const merged: MarkdownNode[] = [];
  for (const node of nodes) {
    const last = merged.at(-1);
    if (node.type === 'text' && last?.type === 'text') last.value += node.value;
    else if (node.type !== 'text' || node.value !== '') merged.push(node);
  }
  return merged;
}

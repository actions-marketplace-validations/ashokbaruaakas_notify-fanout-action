import type { MarkdownNode } from '../../message/markdown.js';
import { parseMarkdown } from '../../message/markdown.js';
import type { Message } from '../../message/model.js';
import type { Mark, Run } from './runs.js';

export const PARSE_MODES = ['html', 'markdownv2', 'none'] as const;
export type ParseMode = (typeof PARSE_MODES)[number];

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const escapeHtmlAttribute = (text: string): string => escapeHtml(text).replaceAll('"', '&quot;');

/** Outside code and link URLs, MarkdownV2 requires escaping all of these. */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

const escapeMarkdownV2Code = (text: string): string => text.replace(/[`\\]/g, '\\$&');
const escapeMarkdownV2Url = (text: string): string => text.replace(/[)\\]/g, '\\$&');
const identity = (text: string): string => text;

/** How one parse mode spells each mark. Every call returns a new mark (marks compare by identity). */
interface Syntax {
  escape: (text: string) => string;
  codeEscape: (text: string) => string;
  bold: () => Mark | undefined;
  italic: () => Mark | undefined;
  code: () => Mark | undefined;
  pre: (language: string) => Mark | undefined;
  /** `undefined` means links are written out as "label (url)". */
  link: (url: string) => Mark | undefined;
}

const SYNTAX: Record<ParseMode, Syntax> = {
  html: {
    escape: escapeHtml,
    codeEscape: escapeHtml,
    bold: () => ({ open: '<b>', close: '</b>' }),
    italic: () => ({ open: '<i>', close: '</i>' }),
    code: () => ({ open: '<code>', close: '</code>' }),
    pre: (language) =>
      language
        ? {
            open: `<pre><code class="language-${escapeHtmlAttribute(language)}">`,
            close: '</code></pre>',
          }
        : { open: '<pre>', close: '</pre>' },
    link: (url) => ({ open: `<a href="${escapeHtmlAttribute(url)}">`, close: '</a>' }),
  },
  markdownv2: {
    escape: escapeMarkdownV2,
    codeEscape: escapeMarkdownV2Code,
    bold: () => ({ open: '*', close: '*' }),
    italic: () => ({ open: '_', close: '_' }),
    code: () => ({ open: '`', close: '`' }),
    pre: (language) => ({ open: `\`\`\`${language.replace(/[^\w+#-]/g, '')}\n`, close: '\n```' }),
    link: (url) => ({ open: '[', close: `](${escapeMarkdownV2Url(url)})` }),
  },
  none: {
    escape: identity,
    codeEscape: identity,
    bold: () => undefined,
    italic: () => undefined,
    code: () => undefined,
    pre: () => undefined,
    link: () => undefined,
  },
};

export function escapeFor(mode: ParseMode): (text: string) => string {
  return SYNTAX[mode].escape;
}

const withMark = (marks: readonly Mark[], mark: Mark | undefined): readonly Mark[] =>
  mark ? [...marks, mark] : marks;

function markdownRuns(
  nodes: readonly MarkdownNode[],
  syntax: Syntax,
  marks: readonly Mark[],
): Run[] {
  const text = (value: string, m = marks): Run => ({
    text: value,
    marks: m,
    escape: syntax.escape,
  });
  return nodes.flatMap((node): Run[] => {
    switch (node.type) {
      case 'text':
        return [text(node.value)];
      case 'bold':
        return markdownRuns(node.children, syntax, withMark(marks, syntax.bold()));
      case 'italic':
        return markdownRuns(node.children, syntax, withMark(marks, syntax.italic()));
      // Telegram does not allow code inside other entities, so code drops the outer marks.
      case 'code':
        return [
          { text: node.value, marks: withMark([], syntax.code()), escape: syntax.codeEscape },
        ];
      case 'codeblock':
        return [
          {
            text: node.value,
            marks: withMark([], syntax.pre(node.language)),
            escape: syntax.codeEscape,
          },
        ];
      case 'link': {
        const mark = syntax.link(node.url);
        if (mark) return markdownRuns(node.children, syntax, [...marks, mark]);
        const label = markdownRuns(node.children, syntax, marks);
        const labelText = label.map((r) => r.text).join('');
        return labelText === node.url ? label : [...label, text(` (${node.url})`)];
      }
    }
  });
}

const HTML_TOKEN =
  /<\/?([a-zA-Z][\w-]*)\b[^<>]*>|&(#\d+|#x[0-9a-fA-F]+|lt|gt|amp|quot);|[^<&]+|[<&]/g;

function decodeEntity(entity: string): string {
  switch (entity) {
    case 'lt':
      return '<';
    case 'gt':
      return '>';
    case 'amp':
      return '&';
    case 'quot':
      return '"';
  }
  const code = entity.startsWith('#x')
    ? parseInt(entity.slice(2), 16)
    : parseInt(entity.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/**
 * Reads native Telegram HTML (a `raw` body) into runs so it can be split
 * safely. Tags are kept as written; unmatched closing tags are dropped.
 */
export function htmlRuns(html: string): Run[] {
  const runs: Run[] = [];
  const stack: { name: string; mark: Mark }[] = [];
  for (const match of html.matchAll(HTML_TOKEN)) {
    const [token, tagName, entity] = match;
    const marks = stack.map((s) => s.mark);
    if (tagName !== undefined) {
      const name = tagName.toLowerCase();
      if (token.startsWith('</')) {
        const index = stack.findLastIndex((s) => s.name === name);
        if (index !== -1) stack.splice(index);
      } else {
        stack.push({ name, mark: { open: token, close: `</${name}>` } });
      }
    } else {
      runs.push({
        text: entity === undefined ? token : decodeEntity(entity),
        marks,
        escape: escapeHtml,
      });
    }
  }
  return runs;
}

const LINE = '\n';
const BLOCK = '\n\n';

export function isButtonUrl(url: string): boolean {
  try {
    return ['http:', 'https:', 'tg:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Lays out a message as runs: bold title, body, then one field per line.
 * Links that cannot be buttons are listed as text at the end.
 */
export function messageRuns(message: Message, mode: ParseMode): Run[] {
  const syntax = SYNTAX[mode];
  const plain = (text: string, marks: readonly Mark[] = []): Run => ({
    text,
    marks,
    escape: syntax.escape,
  });
  const blocks: Run[][] = [];

  if (message.title !== '') blocks.push([plain(message.title, withMark([], syntax.bold()))]);

  if (message.body !== '') {
    switch (message.format) {
      case 'text':
        blocks.push([plain(message.body)]);
        break;
      case 'markdown':
        blocks.push(markdownRuns(parseMarkdown(message.body), syntax, []));
        break;
      case 'raw':
        blocks.push(
          mode === 'html'
            ? htmlRuns(message.body)
            : [{ text: message.body, marks: [], escape: identity }],
        );
        break;
    }
  }

  const lines: Run[][] = message.fields.map((field) => [
    plain(`${field.name}:`, withMark([], syntax.bold())),
    plain(` ${field.value}`),
  ]);
  for (const link of message.links.filter((l) => !isButtonUrl(l.url))) {
    lines.push([plain(link.label === link.url ? link.url : `${link.label}: ${link.url}`)]);
  }
  if (lines.length > 0)
    blocks.push(lines.flatMap((line, i) => (i === 0 ? line : [plain(LINE), ...line])));

  return blocks.flatMap((block, i) => (i === 0 ? block : [plain(BLOCK), ...block]));
}

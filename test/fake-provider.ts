import { ObjectReader } from '../src/config/reader.js';
import type { MarkdownNode } from '../src/message/markdown.js';
import { parseMarkdown } from '../src/message/markdown.js';
import type { Message } from '../src/message/model.js';
import { httpRequest, httpStatusError } from '../src/providers/http.js';
import type { Provider } from '../src/providers/types.js';

export interface FakeConfig {
  token: string;
  channel: string;
}

export const FAKE_API = 'https://fake.invalid';

function renderMarkdown(nodes: MarkdownNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'bold':
          return `<b>${renderMarkdown(node.children)}</b>`;
        case 'italic':
          return `<i>${renderMarkdown(node.children)}</i>`;
        case 'code':
          return `<code>${node.value}</code>`;
        case 'codeblock':
          return `<pre lang="${node.language}">${node.value}</pre>`;
        case 'link':
          return `<a href="${node.url}">${renderMarkdown(node.children)}</a>`;
      }
    })
    .join('');
}

function renderBody(message: Message): string {
  switch (message.format) {
    case 'text':
    case 'raw':
      return message.body;
    case 'markdown':
      return renderMarkdown(parseMarkdown(message.body));
  }
}

/**
 * A provider for tests. It renders the neutral message to readable text and
 * posts it to a fake API with the token in the URL path, like Telegram does.
 */
export const fakeProvider: Provider<FakeConfig, string> = {
  id: 'fake',
  validate(raw) {
    const reader = ObjectReader.from(raw, 'fake options');
    const config = {
      token: reader.requiredString('token'),
      channel: reader.requiredString('channel'),
    };
    reader.assertNoUnknownKeys();
    return config;
  },
  secrets: (config) => [config.token],
  escapeRaw: (value) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  render(message, config) {
    const lines = [`#${config.channel} [${message.status}]`, message.title, renderBody(message)];
    for (const field of message.fields)
      lines.push(`${field.short ? '·' : '-'} ${field.name}: ${field.value}`);
    for (const link of message.links) lines.push(`> ${link.label}: ${link.url}`);
    return lines.filter((line) => line !== '').join('\n');
  },
  async send(rendered, config, context) {
    const response = await httpRequest(context, {
      method: 'POST',
      url: `${FAKE_API}/bot${config.token}/send`,
      body: JSON.stringify({ channel: config.channel, text: rendered }),
    });
    if (!response.ok) throw httpStatusError(response, await response.text());
    const data = (await response.json()) as { id?: unknown };
    return typeof data.id === 'string' ? { messageId: data.id } : {};
  },
};

import { escapeMarkdown } from './markdown.js';
import { STATUS_EMOJI } from './model.js';
import type { Field, Format, Link, Message, ResolvedStatus } from './model.js';
import type { ContentTemplate } from './presets.js';
import { expand } from './template.js';

/** Content settings that can be given globally or per target. `template` is the file's contents. */
export interface ContentOverrides {
  title?: string | undefined;
  message?: string | undefined;
  template?: string | undefined;
  format?: Format | undefined;
}

export interface GlobalContent extends ContentOverrides {
  fields?: Field[] | undefined;
  links?: Link[] | undefined;
}

export interface ComposeInput {
  preset: ContentTemplate;
  status: ResolvedStatus;
  global: GlobalContent;
  target: ContentOverrides;
  /** Context variables, without the message variables (STATUS, EMOJI, TITLE, MESSAGE). */
  variables: ReadonlyMap<string, string>;
  /** Escapes a value for the provider's native format, used when `format` is `raw`. */
  escapeRaw: (value: string) => string;
  onUnknownVariable: (name: string) => void;
}

const identity = (value: string): string => value;
const MESSAGE_ONLY = new Set(['MESSAGE']);

/**
 * Builds one target's message. Title, fields and links are plain text; the
 * body is in `format`, so variable values are escaped for that format.
 *
 * The body comes from the most specific source: the target's template or
 * message, then the global template or message, then the preset. `{{MESSAGE}}`
 * inside a template is the resolved message, and `{{TITLE}}` the resolved title.
 */
export function composeMessage(input: ComposeInput): Message {
  const { global, target, preset, status } = input;
  const format = target.format ?? global.format ?? 'text';
  const escape =
    format === 'markdown' ? escapeMarkdown : format === 'raw' ? input.escapeRaw : identity;

  const variables = new Map(input.variables);
  variables.set('STATUS', status.label);
  variables.set('EMOJI', STATUS_EMOJI[status.status]);
  variables.set('TITLE', '');
  variables.set('MESSAGE', '');

  const onUnknown = input.onUnknownVariable;
  const plain = (template: string): string =>
    expand(template, variables, { escape: identity, onUnknown });

  const title = plain(target.title ?? global.title ?? preset.title)
    .replace(/\s+/g, ' ')
    .trim();
  variables.set('TITLE', title);

  const message = expand(target.message ?? global.message ?? preset.body, variables, {
    escape,
    onUnknown,
  });
  variables.set('MESSAGE', message);

  const template = target.template ?? (target.message === undefined ? global.template : undefined);
  const body =
    template === undefined
      ? message
      : expand(template, variables, { escape, preformatted: MESSAGE_ONLY, onUnknown });

  const fields = (global.fields ?? preset.fields)
    .map((f) => ({ name: plain(f.name).trim(), value: plain(f.value).trim(), short: f.short }))
    .filter((f) => f.value !== '');
  const links = (global.links ?? preset.links)
    .map((l) => {
      const url = plain(l.url).trim();
      return { label: plain(l.label).trim() || url, url };
    })
    .filter((l) => l.url !== '');

  return { title, body: body.trim(), format, status: status.status, fields, links };
}

import { FAIL_ON } from '../engine/policy.js';
import type { FailOn } from '../engine/policy.js';
import { FORMATS } from '../message/model.js';
import type { Field, Format, Link } from '../message/model.js';
import { PRESETS } from '../message/presets.js';
import type { PresetName } from '../message/presets.js';
import { ConfigError, ObjectReader, withPrefix } from './reader.js';
import { parseYamlList } from './yaml.js';

export const MAX_INPUT_LENGTH = 64 * 1024;
export const MAX_FIELDS = 25;
export const MAX_LINKS = 10;

export interface Inputs {
  status: string;
  preset: PresetName;
  title: string | undefined;
  message: string | undefined;
  fields: Field[] | undefined;
  links: Link[] | undefined;
  templateFile: string | undefined;
  format: Format;
  targets: string | undefined;
  telegramBotToken: string | undefined;
  telegramChatId: string | undefined;
  failOn: FailOn;
  retries: number;
  timeoutSeconds: number;
  concurrency: number;
  dryRun: boolean;
  debug: boolean;
}

export type GetInput = (name: string) => string;

/** Reads and validates the action inputs. Empty inputs count as unset. */
export function readInputs(getInput: GetInput): Inputs {
  const get = (name: string): string | undefined => {
    const value = getInput(name);
    if (value.length > MAX_INPUT_LENGTH) {
      throw new ConfigError(`${name} is longer than ${String(MAX_INPUT_LENGTH)} characters`);
    }
    return value.trim() === '' ? undefined : value;
  };
  const choice = <T extends string>(name: string, values: readonly T[], fallback: T): T => {
    const value = get(name)?.trim().toLowerCase();
    if (value === undefined) return fallback;
    const match = values.find((v) => v === value);
    if (match === undefined) throw new ConfigError(`${name} must be one of: ${values.join(', ')}`);
    return match;
  };
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const value = get(name)?.trim();
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      throw new ConfigError(`${name} must be an integer from ${String(min)} to ${String(max)}`);
    }
    return number;
  };
  const boolean = (name: string): boolean =>
    choice(name, ['true', 'false'] as const, 'false') === 'true';

  const fieldsInput = get('fields');
  const linksInput = get('links');

  return {
    status: get('status')?.trim() ?? 'info',
    preset: choice('preset', PRESETS, 'auto'),
    title: get('title'),
    message: get('message'),
    fields: fieldsInput === undefined ? undefined : parseFields(fieldsInput),
    links: linksInput === undefined ? undefined : parseLinks(linksInput),
    templateFile: get('template-file')?.trim(),
    format: choice('format', FORMATS, 'text'),
    targets: get('targets'),
    telegramBotToken: get('telegram-bot-token')?.trim(),
    telegramChatId: get('telegram-chat-id')?.trim(),
    failOn: choice('fail-on', FAIL_ON, 'any'),
    retries: integer('retries', 3, 0, 10),
    timeoutSeconds: integer('timeout-seconds', 15, 1, 300),
    concurrency: integer('concurrency', 5, 1, 50),
    dryRun: boolean('dry-run'),
    debug: boolean('debug'),
  };
}

export function parseFields(source: string): Field[] {
  return parseYamlList(source, 'fields', MAX_FIELDS).map((entry, i) =>
    withPrefix(`fields[${String(i)}]`, () => {
      const reader = ObjectReader.from(entry, 'each field');
      const field = {
        name: reader.requiredString('name'),
        value: reader.requiredString('value'),
        short: reader.optionalBoolean('short') ?? false,
      };
      reader.assertNoUnknownKeys();
      return field;
    }),
  );
}

export function parseLinks(source: string): Link[] {
  return parseYamlList(source, 'links', MAX_LINKS).map((entry, i) =>
    withPrefix(`links[${String(i)}]`, () => {
      const reader = ObjectReader.from(entry, 'each link');
      const link = { label: reader.requiredString('label'), url: reader.requiredString('url') };
      reader.assertNoUnknownKeys();
      return link;
    }),
  );
}

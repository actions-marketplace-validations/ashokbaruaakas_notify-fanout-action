import type { Format } from '../message/model.js';
import { FORMATS } from '../message/model.js';
import type { BoundTarget, ProviderRegistry } from '../providers/registry.js';
import type { Inputs } from './inputs.js';
import { ConfigError, ObjectReader, withPrefix } from './reader.js';
import { parseYamlList } from './yaml.js';

export const MAX_TARGETS = 50;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface TargetContent {
  title: string | undefined;
  message: string | undefined;
  templateFile: string | undefined;
  format: Format | undefined;
}

export interface Target {
  id: string;
  provider: string;
  content: TargetContent;
  bound: BoundTarget;
}

/**
 * Builds the target list: the simple-mode Telegram target (if given) first,
 * then each `targets` entry. Calls `onSecrets` as soon as each target's
 * secrets are known, before anything else can log them.
 */
export function parseTargets(
  inputs: Inputs,
  registry: ProviderRegistry,
  onSecrets: (secrets: readonly string[]) => void,
): Target[] {
  const entries: { label: string; raw: unknown }[] = [];

  const { telegramBotToken: token, telegramChatId: chatId } = inputs;
  if (token !== undefined || chatId !== undefined) {
    if (token === undefined || chatId === undefined) {
      throw new ConfigError('telegram-bot-token and telegram-chat-id must be set together');
    }
    entries.push({
      label: 'telegram-bot-token/telegram-chat-id',
      raw: { provider: 'telegram', token, chat_id: chatId },
    });
  }
  if (inputs.targets !== undefined) {
    parseYamlList(inputs.targets, 'targets', MAX_TARGETS).forEach((raw, i) => {
      entries.push({ label: `targets[${String(i)}]`, raw });
    });
  }
  if (entries.length === 0) {
    throw new ConfigError(
      'No targets configured. Set telegram-bot-token and telegram-chat-id, or targets.',
    );
  }
  if (entries.length > MAX_TARGETS) {
    throw new ConfigError(`More than ${String(MAX_TARGETS)} targets configured`);
  }

  const parsed = entries.map(({ label, raw }) => {
    const reader = withPrefix(label, () => ObjectReader.from(raw, 'each target'));
    const id = withPrefix(label, () => reader.optionalString('id')?.trim());
    const where = id === undefined ? label : `${label} (${id})`;
    return withPrefix(where, () => {
      if (id !== undefined && !ID_PATTERN.test(id)) {
        throw new ConfigError('id may contain only letters, digits, ".", "_" and "-" (max 64)');
      }
      const provider = reader.requiredString('provider').trim().toLowerCase();
      const content: TargetContent = {
        title: reader.optionalString('title'),
        message: reader.optionalString('message'),
        templateFile: reader.optionalString('template_file')?.trim(),
        format: reader.optionalEnum('format', FORMATS),
      };
      const bound = registry.bind(provider, reader.rest());
      onSecrets(bound.secrets);
      return { id, provider, content, bound };
    });
  });

  const taken = new Set<string>();
  for (const { id } of parsed) {
    if (id === undefined) continue;
    if (taken.has(id)) throw new ConfigError(`Duplicate target id "${id}"`);
    taken.add(id);
  }
  const counters = new Map<string, number>();
  return parsed.map(({ id, ...target }) => {
    if (id !== undefined) return { id, ...target };
    let n = counters.get(target.provider) ?? 0;
    let generated: string;
    do generated = `${target.provider}-${String(++n)}`;
    while (taken.has(generated));
    counters.set(target.provider, n);
    taken.add(generated);
    return { id: generated, ...target };
  });
}

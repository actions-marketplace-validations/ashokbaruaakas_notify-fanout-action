import type { Message } from '../message/model.js';
import { ConfigError } from '../config/reader.js';
import type { Provider, SendContext, SendResult } from './types.js';

/** A provider bound to one target's validated config, so callers never handle provider types. */
export interface BoundTarget {
  readonly secrets: readonly string[];
  escapeRaw(value: string): string;
  render(message: Message): RenderedTarget;
}

export interface RenderedTarget {
  /** What `render` produced, for dry runs and debug logs. */
  readonly preview: unknown;
  send(context: SendContext): Promise<SendResult>;
}

function bind<Config, Rendered>(provider: Provider<Config, Rendered>, raw: unknown): BoundTarget {
  const config = provider.validate(raw);
  return {
    secrets: provider.secrets(config).filter((secret) => secret !== ''),
    escapeRaw: (value) => provider.escapeRaw(value, config),
    render: (message) => {
      const rendered = provider.render(message, config);
      return { preview: rendered, send: (context) => provider.send(rendered, config, context) };
    },
  };
}

export class ProviderRegistry {
  private readonly binders = new Map<string, (raw: unknown) => BoundTarget>();

  register<Config, Rendered>(provider: Provider<Config, Rendered>): this {
    this.binders.set(provider.id, (raw) => bind(provider, raw));
    return this;
  }

  ids(): string[] {
    return [...this.binders.keys()];
  }

  bind(providerId: string, raw: unknown): BoundTarget {
    const binder = this.binders.get(providerId);
    if (!binder) {
      const known = this.ids();
      const hint = known.length > 0 ? `; available: ${known.join(', ')}` : '';
      throw new ConfigError(`unknown provider "${providerId}"${hint}`);
    }
    return binder(raw);
  }
}

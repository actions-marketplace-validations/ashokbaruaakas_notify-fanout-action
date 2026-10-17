import { ProviderRegistry } from './registry.js';

/** Every provider the action ships with. Register new providers here. */
export function createDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}

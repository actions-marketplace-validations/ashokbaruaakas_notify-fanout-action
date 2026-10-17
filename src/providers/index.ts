import { ProviderRegistry } from './registry.js';
import { telegram } from './telegram/index.js';

/** Every provider the action ships with. Register new providers here. */
export function createDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry().register(telegram);
}

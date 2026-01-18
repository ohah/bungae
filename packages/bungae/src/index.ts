/**
 * Bungae - A lightning-fast React Native bundler powered by Bun
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.1';

// Re-export config types
export type {
  BungaeConfig,
  ResolvedConfig,
  ResolverConfig,
  TransformerConfig,
  SerializerConfig,
  Platform,
  Mode,
  BundleType,
} from './config/types';

// Re-export config utilities
export {
  loadConfig,
  resolveConfig,
  getDefaultConfig,
  mergeConfig,
  DEFAULT_RESOLVER,
  DEFAULT_TRANSFORMER,
  DEFAULT_SERIALIZER,
} from './config';

// Re-export resolver
export { createPlatformResolverPlugin } from './resolver';
export type { PlatformResolverOptions } from './resolver';

/**
 * Define configuration with type safety
 */
export function defineConfig(
  config: import('./config/types').BungaeConfig,
): import('./config/types').BungaeConfig {
  return config;
}

export async function build(config: import('./config/types').ResolvedConfig): Promise<void> {
  console.log('Bungae build started...', config);
  // TODO: Implement build logic
}

export async function serve(config: import('./config/types').ResolvedConfig): Promise<void> {
  console.log('Bungae dev server started...', config);
  // TODO: Implement dev server logic
}

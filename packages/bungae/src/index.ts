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
  defineConfig,
  DEFAULT_RESOLVER,
  DEFAULT_TRANSFORMER,
  DEFAULT_SERIALIZER,
} from './config';

// Re-export resolver
export { createPlatformResolverPlugin } from './resolver';
export type { PlatformResolverOptions } from './resolver';

// Re-export transformer
export { transform } from './transformer';
export type { TransformOptions, TransformResult } from './transformer';

// Re-export serializer
export {
  baseJSBundle,
  getPrependedModules,
  createModuleIdFactory,
  getRunModuleStatement,
} from './serializer';
export type { Module, Bundle, SerializerOptions } from './serializer';

export async function build(config: import('./config/types').ResolvedConfig): Promise<void> {
  console.log('Bungae build started...', config);
  // TODO: Implement build logic
  // Phase 1-3: Transformation and Serialization are ready
  // Phase 2: Will implement full build pipeline with dependency graph
}

export async function serve(config: import('./config/types').ResolvedConfig): Promise<void> {
  console.log('Bungae dev server started...', config);
  // TODO: Implement dev server logic
  // Phase 2: Will implement dev server with HMR
}

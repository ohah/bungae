/**
 * Configuration module
 */

export * from './types';
export {
  getDefaultConfig,
  DEFAULT_RESOLVER,
  DEFAULT_TRANSFORMER,
  DEFAULT_SERIALIZER,
  DEFAULT_SERVER,
} from './defaults';
export { loadConfig, resolveConfig } from './load';
export { mergeConfig } from './merge';
export { validateConfig, ConfigValidationError } from './validate';

/**
 * Define configuration with type safety
 */
export function defineConfig(
  config: import('./types').BungaeConfig,
): import('./types').BungaeConfig {
  return config;
}

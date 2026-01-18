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
export { defineConfig } from '../index';

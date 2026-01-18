/**
 * Configuration merger
 */

import type { BungaeConfig, ResolvedConfig } from './types';

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      !((sourceValue as any) instanceof RegExp) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue) &&
      !((targetValue as any) instanceof RegExp)
    ) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[Extract<keyof T, string>];
    }
  }

  return result;
}

/**
 * Merge user config with defaults
 * Supports Metro-style chaining: mergeConfig(defaults, config1, config2, ...)
 */
export function mergeConfig(
  defaults: ResolvedConfig,
  ...userConfigs: BungaeConfig[]
): ResolvedConfig {
  let merged: ResolvedConfig = { ...defaults };

  // Chain merge all user configs (Metro style)
  for (const userConfig of userConfigs) {
    if (!userConfig) continue;

    merged = {
      ...merged,
      ...userConfig,
      resolver: deepMerge(merged.resolver, userConfig.resolver || {}),
      transformer: deepMerge(merged.transformer, userConfig.transformer || {}),
      serializer: deepMerge(merged.serializer, userConfig.serializer || {}),
      server: deepMerge(merged.server, userConfig.server || {}),
    };

    // Handle mode -> dev conversion
    if (userConfig.mode) {
      merged.dev = userConfig.mode === 'development';
    }

    // Handle dev -> mode conversion
    if (userConfig.dev !== undefined) {
      merged.mode = userConfig.dev ? 'development' : 'production';
    }
  }

  return merged;
}

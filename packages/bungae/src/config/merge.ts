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

    // Skip null values (they should be assigned directly, not merged)
    if (sourceValue === null) {
      result[key] = sourceValue as T[Extract<keyof T, string>];
      continue;
    }

    // Deep merge nested objects
    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      !((sourceValue as any) instanceof RegExp) &&
      targetValue !== null &&
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

    // Deep merge nested configs first to avoid overwriting with shallow spread
    const nestedMerged = {
      resolver: deepMerge(merged.resolver, userConfig.resolver || {}),
      transformer: deepMerge(merged.transformer, userConfig.transformer || {}),
      serializer: deepMerge(merged.serializer, userConfig.serializer || {}),
      server: deepMerge(merged.server, userConfig.server || {}),
      experimental: deepMerge(merged.experimental, userConfig.experimental || {}),
    };

    // Merge top-level properties, with nested configs taking precedence
    merged = {
      ...merged,
      ...userConfig,
      ...nestedMerged,
    };

    // Handle mode -> dev conversion
    if (userConfig.mode !== undefined) {
      merged.dev = userConfig.mode === 'development';
      merged.mode = userConfig.mode;
    }

    // Handle dev -> mode conversion
    if (userConfig.dev !== undefined) {
      merged.dev = userConfig.dev;
      merged.mode = userConfig.dev ? 'development' : 'production';
    }
  }

  return merged;
}

/**
 * Configuration loader
 * Metro-compatible API
 */

import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { getDefaultConfig } from './defaults';
import { mergeConfig } from './merge';
import type { BungaeConfig, ResolvedConfig } from './types';
import { validateConfig } from './validate';

export interface LoadConfigOptions {
  config?: string;
  cwd?: string;
}

/**
 * Format config loading error with detailed information
 */
function formatConfigLoadError(configPath: string, error: unknown): Error {
  const errorName = error instanceof Error ? error.constructor.name : 'Error';
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Build detailed error message
  let detailedMessage = `Failed to load config file: ${configPath}\n`;
  detailedMessage += `Error Type: ${errorName}\n`;
  detailedMessage += `Error Message: ${errorMessage}\n`;

  // Handle AggregateError (contains multiple errors)
  if (error instanceof AggregateError && error.errors) {
    detailedMessage += `\nThis error contains ${error.errors.length} sub-error(s):\n`;
    error.errors.forEach((subError, index) => {
      const subErrorName = subError instanceof Error ? subError.constructor.name : 'Error';
      const subErrorMessage = subError instanceof Error ? subError.message : String(subError);
      const subErrorStack = subError instanceof Error ? subError.stack : undefined;

      detailedMessage += `\n  Error ${index + 1}:\n`;
      detailedMessage += `    Type: ${subErrorName}\n`;
      detailedMessage += `    Message: ${subErrorMessage}\n`;

      if (subErrorStack) {
        const stackLines = subErrorStack.split('\n').slice(0, 3).join('\n');
        detailedMessage += `    Stack:\n${stackLines
          .split('\n')
          .map((line) => `      ${line}`)
          .join('\n')}\n`;
      }
    });
  }

  // Add stack trace if available (helpful for debugging)
  if (errorStack) {
    // Limit stack trace to first 5 lines to avoid too much noise
    const stackLines = errorStack.split('\n').slice(0, 6).join('\n');
    detailedMessage += `\nStack Trace:\n${stackLines}`;
  }

  // Add helpful context for common errors
  if (errorMessage.includes('duplicate name') || errorMessage.includes('duplicate export')) {
    detailedMessage += `\n\nPossible causes:\n`;
    detailedMessage += `  1. The config file may be exporting a name that conflicts with 'bungae' package exports\n`;
    detailedMessage += `  2. Check if you're accidentally exporting 'loadConfig' or other names from bungae package\n`;
    detailedMessage += `  3. This might be a Bun module resolution issue with dynamic imports\n`;
  }

  // Add context for AggregateError related to building
  if (errorMessage.includes('building') || errorMessage.includes('chunk')) {
    detailedMessage += `\n\nPossible causes:\n`;
    detailedMessage += `  1. The 'bungae' package may need to be rebuilt (run 'bun run build' in packages/bungae)\n`;
    detailedMessage += `  2. There may be issues with the built dist files\n`;
    detailedMessage += `  3. Try cleaning and rebuilding: 'rm -rf packages/bungae/dist && bun run build'\n`;
  }

  // Preserve original error as cause for debugging
  const cause = error instanceof Error ? error : new Error(String(error));
  return new Error(detailedMessage, { cause });
}

/**
 * Load configuration from file
 * Metro-compatible: loadConfig({ config: path }) or loadConfig({ cwd: dir })
 */
export async function loadConfig(options: LoadConfigOptions | string = {}): Promise<BungaeConfig> {
  let root: string;
  let explicitConfigPath: string | undefined;

  // Handle string argument (backward compatibility)
  if (typeof options === 'string') {
    root = options;
  } else {
    root = options.cwd || process.cwd();
    explicitConfigPath = options.config;
  }

  // If explicit config path is provided, load it directly
  if (explicitConfigPath) {
    const configPath = resolve(root, explicitConfigPath);
    if (!existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    try {
      if (configPath.endsWith('.json')) {
        const config = await Bun.file(configPath).json();
        return config as BungaeConfig;
      } else {
        // Dynamic import for .ts/.js files
        const module = await import(configPath);
        let config = module.default || module;
        // Handle promise exports
        if (config instanceof Promise) {
          config = await config;
        }
        // Handle function exports
        if (typeof config === 'function') {
          const defaults = getDefaultConfig(dirname(configPath));
          config = config(defaults);
        }
        return config as BungaeConfig;
      }
    } catch (error) {
      throw formatConfigLoadError(configPath, error);
    }
  }

  // Otherwise, search for config files
  const configPaths = [
    join(root, 'bungae.config.ts'),
    join(root, 'bungae.config.js'),
    join(root, 'bungae.config.json'),
  ];

  // Try to load from config file
  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        if (configPath.endsWith('.json')) {
          const config = await Bun.file(configPath).json();
          return config as BungaeConfig;
        } else {
          // Dynamic import for .ts/.js files
          const module = await import(configPath);
          let config = module.default || module;
          // Handle promise exports
          if (config instanceof Promise) {
            config = await config;
          }
          // Handle function exports
          if (typeof config === 'function') {
            const defaults = getDefaultConfig(root);
            config = config(defaults);
          }
          return config as BungaeConfig;
        }
      } catch (error) {
        throw formatConfigLoadError(configPath, error);
      }
    }
  }

  // Try to load from package.json
  const packageJsonPath = join(root, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = (await Bun.file(packageJsonPath).json()) as { bungae?: BungaeConfig };
      if (packageJson.bungae) {
        return packageJson.bungae;
      }
    } catch {
      // Ignore package.json errors, use defaults
    }
  }

  // Return empty config (will be merged with defaults)
  return {};
}

/**
 * Resolve configuration with defaults
 */
export function resolveConfig(
  userConfig: BungaeConfig,
  root: string = process.cwd(),
): ResolvedConfig {
  // Validate config before merging
  validateConfig(userConfig);

  const defaults = getDefaultConfig(root);
  return mergeConfig(defaults, userConfig);
}

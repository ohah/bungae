/**
 * Prelude Plugin for Rolldown
 *
 * Injects React Native global variables and polyfills at the entry point.
 * These must execute before any app code:
 * - __DEV__ (development mode flag)
 * - process.env.NODE_ENV
 * - ErrorUtils (error handling)
 * - global/globalThis setup
 */

import { readFileSync } from 'fs';

import type { Plugin } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';

const ENTRY_META_KEY = 'bungae:is-entry';

export interface PreludeOptions {
  /** Additional module paths to import at entry (e.g., InitializeCore) */
  preludeModules?: string[];
}

export function preludePlugin(config: ResolvedConfig, options: PreludeOptions = {}): Plugin {
  const { dev, platform } = config;
  const { preludeModules = [] } = options;

  return {
    name: 'bungae:prelude',

    resolveId: {
      handler(source, _importer, extraOptions) {
        if (extraOptions.isEntry) {
          return { id: source, meta: { [ENTRY_META_KEY]: true } };
        }
        return null;
      },
    },

    load: {
      handler(id) {
        const moduleInfo = this.getModuleInfo(id);
        if (!moduleInfo?.meta?.[ENTRY_META_KEY]) return null;

        const originalSource = readFileSync(id, 'utf-8');

        // Build prelude code
        const preludeCode = generatePreludeCode(dev, platform);

        // Build prelude imports
        const preludeImports = preludeModules.map((mod) => `import '${mod}';`).join('\n');

        const modifiedSource = [preludeCode, preludeImports, originalSource]
          .filter(Boolean)
          .join('\n');

        return modifiedSource;
      },
    },
  };
}

/**
 * Generate prelude code that sets up React Native globals
 */
export function generatePreludeCode(dev: boolean, _platform: string): string {
  return `
// Bungae prelude - React Native globals
var __DEV__ = ${dev};
var __BUNDLE_START_TIME__ = globalThis.nativePerformanceNow ? nativePerformanceNow() : Date.now();
var process = globalThis.process || {};
process.env = process.env || {};
process.env.NODE_ENV = ${JSON.stringify(dev ? 'development' : 'production')};
globalThis.__DEV__ = __DEV__;
globalThis.process = process;
`.trim();
}

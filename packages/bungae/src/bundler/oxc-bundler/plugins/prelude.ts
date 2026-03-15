/**
 * Prelude Plugin for Rolldown
 *
 * Injects React Native global variables, polyfills, and prelude modules
 * at the entry point. Execution order:
 *
 * 1. Prelude code (__DEV__, process.env.NODE_ENV, etc.)
 * 2. Polyfill imports (console.js, error-guard.js — from rn-get-polyfills)
 * 3. Prelude module imports (InitializeCore, etc.)
 * 4. Original entry source
 *
 * Polyfills are imported as regular Rolldown modules so they receive proper
 * source maps. Previously they were injected via `intro` with no mappings,
 * which broke DevTools console.log source locations.
 */

import { readFileSync } from 'fs';

import type { Plugin } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';

const ENTRY_META_KEY = 'bungae:is-entry';

export interface PreludeOptions {
  /** Additional module paths to import at entry (e.g., InitializeCore) */
  preludeModules?: string[];
  /** Polyfill file paths (from rn-get-polyfills) to import before prelude modules */
  polyfillPaths?: string[];
}

export function preludePlugin(config: ResolvedConfig, options: PreludeOptions = {}): Plugin {
  const { dev, platform } = config;
  const { preludeModules = [], polyfillPaths = [] } = options;

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

        // Build prelude code (RN globals: __DEV__, process.env, etc.)
        const preludeCode = generatePreludeCode(dev, platform);

        // Build polyfill imports (console.js, error-guard.js — must run before prelude modules)
        const polyfillImports = polyfillPaths.map((mod) => `import '${mod}';`).join('\n');

        // Build prelude module imports (InitializeCore, etc.)
        const preludeImports = preludeModules.map((mod) => `import '${mod}';`).join('\n');

        const modifiedSource = [preludeCode, polyfillImports, preludeImports, originalSource]
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
export function generatePreludeCode(dev: boolean, platform: string): string {
  return `
// Bungae prelude - React Native globals
var __DEV__ = ${dev};
var __BUNDLE_START_TIME__ = globalThis.nativePerformanceNow ? nativePerformanceNow() : Date.now();
var process = globalThis.process || {};
process.env = process.env || {};
process.env.NODE_ENV = ${JSON.stringify(dev ? 'development' : 'production')};
globalThis.__DEV__ = __DEV__;
globalThis.process = process;
globalThis.__BUNGAE_BUNDLER__ = true;
globalThis.__BUNGAE_VERSION__ = "oxc";
globalThis.__BUNGAE_PLATFORM__ = ${JSON.stringify(platform)};
`.trim();
}

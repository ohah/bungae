/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Downlevels JavaScript syntax that Hermes doesn't support:
 * - Private class fields (#field) → WeakMap-based polyfill
 * - Private methods (#method()) → WeakMap-based polyfill
 *
 * Uses SWC to transform the final output chunk, so it catches
 * both user code and Rolldown's own runtime (e.g., DevEngine runtime).
 *
 * Target: ES2020 (Hermes supports most ES2020 except private fields)
 */

import type { Plugin } from 'rolldown';

export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    // renderChunk runs on the final output, after all modules are bundled.
    // This ensures we catch private fields from any source (user code, node_modules, runtime).
    renderChunk: {
      async handler(code, _chunk) {
        // Quick check: skip SWC if no private fields
        if (!code.includes('#')) {
          return null;
        }

        // Only transform if there are actual private field patterns
        // (#identifier followed by word chars, not #region or sourcemap comments)
        if (!/(?:this\.#|\.#[a-zA-Z_]|#[a-zA-Z_]\w*[;=,()])/.test(code)) {
          return null;
        }

        try {
          const swc = await import('@swc/core');

          const result = await swc.transform(code, {
            jsc: {
              parser: {
                syntax: 'ecmascript',
              },
              target: 'es2020',
              // Private fields → WeakMap transform
              transform: {
                useDefineForClassFields: false,
              },
            },
            // Preserve source maps
            sourceMaps: true,
          });

          return {
            code: result.code,
            map: result.map || undefined,
          };
        } catch (error: any) {
          console.warn(
            `[hermes-compat] SWC transform failed, returning original code: ${error.message}`,
          );
          return null;
        }
      },
    },
  };
}

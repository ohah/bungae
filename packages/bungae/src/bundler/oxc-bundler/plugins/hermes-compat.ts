/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Two post-bundling transformations in `renderChunk`:
 *
 * 1. ES5 downlevel: SWC `target: 'es5'` converts class expressions,
 *    private fields, let/const, arrow functions, etc.
 *
 * 2. Configurable exports: Patch __defProp to set `configurable: true`.
 */

import type { Plugin } from 'rolldown';

export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    renderChunk: {
      async handler(code, _chunk) {
        try {
          const swc = await import('@swc/core');

          // DEBUG: dump raw Rolldown output
          try { require('fs').writeFileSync('/tmp/bungae-raw.js', code); } catch {}

          // Pre-process before SWC es5:
          const preProcessed = code
            .replace(/\(0,\s*([\w$]+(?:\.[\w$]+)*)\s*\)\s*\(/g, '$1(')
            .replace(/\/\* @__PURE__ \*\/ /g, '');

          // DEBUG: dump after pre-processing
          try { require('fs').writeFileSync('/tmp/bungae-preprocessed.js', preProcessed); } catch {}

          const result = await swc.transform(preProcessed, {
            jsc: {
              parser: { syntax: 'ecmascript' },
              target: 'es5',
              assumptions: {
                setPublicClassFields: true,
                privateFieldsAsProperties: true,
              },
            },
            sourceMaps: true,
          });

          const patched = result.code.replace(
            /var __defProp = Object\.defineProperty;/,
            `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
          );

          return {
            code: patched,
            map: result.map || undefined,
          };
        } catch (error: any) {
          console.warn(`[hermes-compat] SWC transform failed: ${error.message}`);
          return null;
        }
      },
    },
  };
}

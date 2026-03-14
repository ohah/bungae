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

          // Strip /* @__PURE__ */ annotations before SWC.
          // SWC es5 has a bug: in `&& /* @__PURE__ */ (0, fn)(args)` context,
          // it replaces `(0, fn)` with `(void 0)`, breaking the function call.
          // These annotations are only for tree-shaking (already done by Rolldown).
          const stripped = code.replace(/\/\* @__PURE__ \*\/ /g, '');

          // DEBUG: verify @__PURE__ was stripped
          const fs = require('fs');
          const pureCount = (stripped.match(/@__PURE__/g) || []).length;
          console.log(`[hermes-compat] @__PURE__ remaining after strip: ${pureCount}, code length: ${stripped.length}`);
          try { fs.writeFileSync('/tmp/bungae-stripped.js', stripped); } catch {}

          const result = await swc.transform(stripped, {
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

          try { fs.writeFileSync('/tmp/bungae-post-swc2.js', result.code); } catch {}

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

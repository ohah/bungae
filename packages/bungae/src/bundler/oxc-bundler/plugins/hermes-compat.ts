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

          // Fix Rolldown bug: in `&& /* @__PURE__ */ (void 0)(args)` context,
          // Rolldown replaces the JSX function reference with `void 0`.
          // Detect the JSX function name from working calls and restore broken ones.
          let fixed = code;
          const jsxDevMatch = code.match(/\(0,\s*([\w$]+\.jsxDEV)\s*\)/);
          const jsxMatch = code.match(/\(0,\s*([\w$]+\.jsx)\s*\)/);
          const jsxFn = jsxDevMatch?.[1] || jsxMatch?.[1];
          if (jsxFn) {
            // Replace `(void 0)(Component,` with `(0, jsxFn)(Component,`
            // Only match (void 0) used as a function call (never legitimate)
            fixed = code.replace(/\(void 0\)\(/g, `(0, ${jsxFn})(`);
          }

          const result = await swc.transform(fixed, {
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

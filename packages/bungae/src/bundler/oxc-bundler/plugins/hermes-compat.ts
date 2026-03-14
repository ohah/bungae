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

          // Pre-process before SWC es5:
          // 1. Strip (0, fn) comma expressions → fn
          //    SWC es5 bug: in `&& (0, fn)(args)`, SWC replaces (0, fn) with (void 0).
          //    The comma expression is only for unbinding `this`, which is unnecessary
          //    in React Native bundled context.
          // 2. Strip /* @__PURE__ */ annotations (only for tree-shaking, already done).
          const preProcessed = code
            .replace(/\(0, ([\w$]+(?:\.[\w$]+)*)\)\(/g, '$1(')
            .replace(/\/\* @__PURE__ \*\/ /g, '');

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

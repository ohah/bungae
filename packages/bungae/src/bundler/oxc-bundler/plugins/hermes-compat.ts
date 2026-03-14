/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Handles three post-bundling transformations in `renderChunk`:
 *
 * 1. ES5 downlevel: SWC `target: 'es5'` converts class expressions,
 *    private fields, let/const, arrow functions, etc.
 *
 * 2. && JSX → ternary: Hermes has a runtime bug with `false` in jsxs
 *    children arrays after SWC es5 transform. Convert `cond && jsx(...)`
 *    to `cond ? jsx(...) : null` which Hermes handles correctly.
 *
 * 3. Configurable exports: Rolldown's __defProp creates exports with
 *    `configurable: false`. Patch to `configurable: true` for RN dev mode.
 */

import type { Plugin } from 'rolldown';

/**
 * Convert `&& (0, jsx)(...)` patterns to ternary `? (0, jsx)(...) : null`.
 *
 * Rolldown's JSX output uses `condition && (0, jsx)(Component, props)`.
 * After SWC es5, Hermes fails when `false` appears in jsxs children arrays
 * and transitions to an element on re-render. Ternary with `null` works.
 */
function patchAndJsxToTernary(code: string): string {
  // Match: <expr> && /* @__PURE__ */ (0, <jsx_fn>)(
  // Replace with: <expr> ? /* @__PURE__ */ (0, <jsx_fn>)( ... : null
  // The pattern is specific to Rolldown's JSX output to avoid false positives.
  return code.replace(
    /(\S+)\s*&&\s*(\/\*\s*@__PURE__\s*\*\/\s*)\(0,\s*(\w+(?:\.\w+)*)\)\(/g,
    '$1 ? $2(0, $3)(',
  ).replace(
    // For each replaced pattern, we need to add `: null` after the closing paren.
    // This is complex with regex alone, so use a simpler approach:
    // Replace `&& (0, fn)(` (without @__PURE__) as well
    /(\S+)\s*&&\s*\(0,\s*(\w+(?:\.\w+)*)\)\(/g,
    '$1 ? (0, $2)(',
  );
}

export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    renderChunk: {
      async handler(code, _chunk) {
        try {
          const swc = await import('@swc/core');

          // DEBUG: dump pre-SWC bundle
          try { require('fs').writeFileSync('/tmp/bungae-pre-swc.js', code); } catch {}

          const result = await swc.transform(code, {
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

          // DEBUG: dump post-SWC bundle
          try { require('fs').writeFileSync('/tmp/bungae-post-swc.js', result.code); } catch {}

          let patched = result.code;

          // Patch __defProp for configurable exports
          patched = patched.replace(
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

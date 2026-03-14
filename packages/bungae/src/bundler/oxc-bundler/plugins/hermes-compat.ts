/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Three post-bundling transformations in `renderChunk`:
 *
 * 1. && JSX → ternary: Convert `cond && (0, jsx)(...)` to
 *    `cond ? (0, jsx)(...) : null`. Hermes + SWC es5 combination
 *    has a runtime issue with `&&` in JSX children arrays.
 *    Applied BEFORE SWC so the ternary form goes through es5 transform.
 *
 * 2. ES5 downlevel: SWC `target: 'es5'` converts class expressions,
 *    private fields, let/const, arrow functions, etc.
 *
 * 3. Configurable exports: Patch __defProp to set `configurable: true`.
 */

import type { Plugin } from 'rolldown';

/**
 * Convert `&& /* @__PURE__ * / (0, fn)(` patterns to ternary.
 *
 * Uses paren-counting to find the end of the JSX call expression,
 * then appends `: null`. Only targets Rolldown's JSX output pattern.
 */
function patchAndJsxToTernary(code: string): string {
  // Find all `&& /* @__PURE__ */ (0,` or `&& (0,` patterns
  const pattern = /(\s*)&&(\s*(?:\/\*[^*]*\*\/\s*)?)\(0,/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const andStart = match.index;
    // Find the start of the `(0, fn)(args)` call — starts at `(0,`
    const callStart = andStart + match[0].length - 3; // position of `(0,`

    // Track balanced parens to find end of `(0, fn)(args)`
    // First: find end of `(0, fn)` — the comma expression
    let depth = 0;
    let i = callStart;
    // Pass through `(0, fn)`
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    // Now `i` is right after `(0, fn)`. Next should be `(args)`.
    if (i < code.length && code[i] === '(') {
      depth = 0;
      for (; i < code.length; i++) {
        if (code[i] === '(') depth++;
        else if (code[i] === ')') {
          depth--;
          if (depth === 0) { i++; break; }
        }
      }
    }

    // Replace: `&& <pure> (0, fn)(args)` → `? <pure> (0, fn)(args) : null`
    result += code.slice(lastIndex, andStart);
    result += match[1] + '?' + match[2] + code.slice(callStart, i) + ' : null';
    lastIndex = i;
  }

  result += code.slice(lastIndex);
  return result;
}

export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    renderChunk: {
      async handler(code, _chunk) {
        try {
          const swc = await import('@swc/core');

          // 1. Convert && JSX to ternary (before SWC)
          const ternaryPatched = patchAndJsxToTernary(code);

          // 2. SWC es5 transform
          const result = await swc.transform(ternaryPatched, {
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

          // 3. Patch __defProp for configurable exports
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

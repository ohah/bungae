/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Two post-bundling transformations in `renderChunk`:
 *
 * 1. ES5 downlevel: SWC `target: 'es5'` converts class expressions,
 *    private fields, let/const, arrow functions, etc.
 *
 * 2. Configurable exports: Patch __defProp to set `configurable: true`.
 *
 * All string manipulations use MagicString to preserve source maps.
 */

import remapping from '@ampproject/remapping';
import MagicString from 'magic-string';
import type { Plugin } from 'rolldown';

const VOID0_CALL_REGEX = /\(void 0\)\(/g;
const DEFPROP_REGEX = /var __defProp = Object\.defineProperty;/;
const DEFPROP_REPLACEMENT =
  'var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };';
// Consistent source filename for MagicString maps in renderChunk (no real filename available)
const CHUNK_SOURCE = 'chunk';

export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    renderChunk: {
      async handler(code, _chunk) {
        try {
          const swc = await import('@swc/core');

          // Step 1: Fix Rolldown (void 0) bug with MagicString (preserves source map)
          const jsxDevMatch = code.match(/\(0,\s*([\w$]+\.jsxDEV)\s*\)/);
          const jsxMatch = code.match(/\(0,\s*([\w$]+\.jsx)\s*\)/);
          const jsxFn = jsxDevMatch?.[1] || jsxMatch?.[1];

          let swcInput = code;
          let voidFixMap: ReturnType<MagicString['generateMap']> | null = null;

          if (jsxFn) {
            const s = new MagicString(code);
            const replacement = `(0, ${jsxFn})(`;
            let match: RegExpExecArray | null;
            VOID0_CALL_REGEX.lastIndex = 0;
            while ((match = VOID0_CALL_REGEX.exec(code)) !== null) {
              s.overwrite(match.index, match.index + match[0].length, replacement);
            }
            swcInput = s.toString();
            voidFixMap = s.generateMap({ hires: true, source: CHUNK_SOURCE });
          }

          // Step 2: SWC ES5 transform with inputSourceMap for (void 0) fix chain
          const result = await swc.transform(swcInput, {
            jsc: {
              parser: { syntax: 'ecmascript' },
              target: 'es5',
              assumptions: {
                setPublicClassFields: true,
                privateFieldsAsProperties: true,
              },
            },
            sourceMaps: true,
            inputSourceMap: voidFixMap ? JSON.stringify(voidFixMap) : undefined,
          });

          // Step 3: Patch __defProp with MagicString (preserves source map)
          const swcCode = result.code;
          const defPropMatch = DEFPROP_REGEX.exec(swcCode);

          if (!defPropMatch || defPropMatch.index === undefined) {
            // No __defProp to patch — return SWC result directly
            return {
              code: swcCode,
              map: result.map || undefined,
            };
          }

          const s2 = new MagicString(swcCode);
          s2.overwrite(
            defPropMatch.index,
            defPropMatch.index + defPropMatch[0].length,
            DEFPROP_REPLACEMENT,
          );
          const finalCode = s2.toString();
          const defPropMap = s2.generateMap({ hires: true, source: CHUNK_SOURCE });

          // Step 4: Compose defProp map with SWC map (which already includes void0 fix)
          if (!result.map) {
            return { code: finalCode, map: JSON.stringify(defPropMap) };
          }

          const composedMap = remapping([defPropMap as any, JSON.parse(result.map)], () => null);

          return {
            code: finalCode,
            map: JSON.stringify(composedMap),
          };
        } catch (error: any) {
          console.warn(`[hermes-compat] SWC transform failed: ${error.message}`);
          return null;
        }
      },
    },
  };
}

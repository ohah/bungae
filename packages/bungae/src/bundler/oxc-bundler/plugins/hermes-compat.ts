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

          // Step 1: SWC ES5 transform
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

          // Step 2: Patch __defProp with MagicString (preserves source map)
          const swcCode = result.code;
          const defPropMatch = DEFPROP_REGEX.exec(swcCode);

          if (!defPropMatch || defPropMatch.index === undefined) {
            // No __defProp to patch — return SWC result directly
            return {
              code: swcCode,
              map: result.map || undefined,
            };
          }

          const s = new MagicString(swcCode);
          s.overwrite(
            defPropMatch.index,
            defPropMatch.index + defPropMatch[0].length,
            DEFPROP_REPLACEMENT,
          );
          const finalCode = s.toString();
          const defPropMap = s.generateMap({ hires: true, source: CHUNK_SOURCE });

          // Step 3: Compose defProp map with SWC map
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

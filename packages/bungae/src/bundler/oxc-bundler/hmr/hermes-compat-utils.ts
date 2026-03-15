/**
 * Hermes Compatibility Utilities
 *
 * Applied in DevEngine's onOutput and onHmrUpdates callbacks.
 *
 * ES5 downlevel is handled per-module by hermesCompatPlugin's `transform` hook.
 * These utilities only handle Rolldown runtime patches (post-bundling).
 *
 * All string manipulations use MagicString to preserve source maps.
 */

import MagicString from 'magic-string';

const DEFPROP_REGEX = /var __defProp = Object\.defineProperty;/;
const DEFPROP_REPLACEMENT =
  'var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };';

/**
 * Patch Rolldown's __defProp to always set configurable: true.
 *
 * Rolldown's runtime uses __defProp (= Object.defineProperty) to create
 * module exports, but doesn't set configurable: true. React Native's
 * deepFreezeAndThrowOnMutationInDev needs configurable properties to
 * add mutation-throwing setters in dev mode.
 *
 * Returns both patched code and source map.
 */
export function patchRolldownRuntime(code: string): { code: string; map?: string } {
  const match = DEFPROP_REGEX.exec(code);
  if (!match || match.index === undefined) {
    return { code };
  }

  const s = new MagicString(code);
  s.overwrite(match.index, match.index + match[0].length, DEFPROP_REPLACEMENT);

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }).toString(),
  };
}

/**
 * Transform code for Hermes compatibility using SWC es5.
 * Used for HMR patches (small code fragments) that bypass the transform hook.
 */
export async function transformForHermes(code: string): Promise<string> {
  const swc = await import('@swc/core');
  const result = await swc.transform(code, {
    jsc: {
      parser: { syntax: 'ecmascript' },
      target: 'es5',
      assumptions: {
        setPublicClassFields: true,
        privateFieldsAsProperties: true,
      },
    },
    sourceMaps: false,
  });
  return result.code;
}

/**
 * Full Hermes compatibility pipeline: SWC transform + __defProp patch.
 * Applied to HMR patches that bypass the per-module transform hook.
 */
export async function applyHermesCompat(code: string): Promise<string> {
  let result = await transformForHermes(code);
  const patched = patchRolldownRuntime(result);
  return patched.code;
}

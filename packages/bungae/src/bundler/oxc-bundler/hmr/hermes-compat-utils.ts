/**
 * Hermes Compatibility Utilities
 *
 * Applied in DevEngine's onOutput and onHmrUpdates callbacks.
 *
 * ES5 downlevel is handled per-module by hermesCompatPlugin's `transform` hook.
 * These utilities only handle Rolldown runtime patches (post-bundling).
 */

/**
 * Patch Rolldown's __defProp to always set configurable: true.
 *
 * Rolldown's runtime uses __defProp (= Object.defineProperty) to create
 * module exports, but doesn't set configurable: true. React Native's
 * deepFreezeAndThrowOnMutationInDev needs configurable properties to
 * add mutation-throwing setters in dev mode.
 */
export function patchRolldownRuntime(code: string): string {
  const patched = code.replace(
    /var __defProp = Object\.defineProperty;/,
    `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
  );

  return patched;
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
  result = patchRolldownRuntime(result);
  return result;
}

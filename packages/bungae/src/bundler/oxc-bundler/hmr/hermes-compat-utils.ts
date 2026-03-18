/**
 * Hermes Compatibility Utilities
 *
 * Applied in DevEngine's onOutput and onHmrUpdates callbacks.
 *
 * ES5 downlevel is handled per-module by hermesCompatPlugin's `transform` hook.
 * These utilities handle SWC ES5 transform for HMR patches (post-bundling).
 */

let swc: typeof import('@swc/core') | null = null;

/**
 * Transform code for Hermes compatibility using SWC es5.
 * Used for HMR patches (small code fragments) that bypass the transform hook.
 */
export async function transformForHermes(code: string): Promise<string> {
  if (!swc) {
    swc = await import('@swc/core');
  }
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
 * Full Hermes compatibility pipeline: SWC ES5 transform.
 * Applied to HMR patches that bypass the per-module transform hook.
 *
 * Note: __defProp patching is no longer needed because the Rolldown fork
 * already sets configurable: true in runtime helpers.
 */
export async function applyHermesCompat(code: string): Promise<string> {
  return transformForHermes(code);
}

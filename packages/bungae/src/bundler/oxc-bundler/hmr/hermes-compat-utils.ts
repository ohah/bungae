/**
 * Hermes Compatibility Utilities
 *
 * Extracted from hermes-compat plugin for reuse in DevEngine's
 * onOutput and onHmrUpdates callbacks, where renderChunk hooks
 * may not be available.
 */

/**
 * Patch Rolldown's __defProp to always set configurable: true.
 * Same logic as hermes-compat plugin but usable outside of renderChunk.
 */
export function patchRolldownRuntime(code: string): string {
  const patched = code.replace(
    /var __defProp = Object\.defineProperty;/,
    `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
  );
  if (patched === code && code.includes('__defProp')) {
    console.warn(
      '[hermes-compat] Failed to patch __defProp in HMR update — ' +
        'Rolldown runtime pattern may have changed.',
    );
  }
  return patched;
}

/**
 * Transform code to ES5 using SWC (for Hermes compatibility).
 * Used as a fallback when renderChunk is not available in dev() API.
 */
export async function transformToES5(code: string): Promise<string> {
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

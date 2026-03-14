/**
 * Hermes Compatibility Utilities
 *
 * Applied in DevEngine's onOutput and onHmrUpdates callbacks,
 * because Rolldown's dev() API does NOT run renderChunk hooks.
 *
 * Two transformations:
 * 1. SWC ES2020 downlevel: transforms #private fields (ES2022) which Hermes doesn't support
 * 2. __defProp patch: forces configurable: true for React Native dev mode compatibility
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
  let patched = code.replace(
    /var __defProp = Object\.defineProperty;/,
    `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
  );

  // DEBUG: Patch __esmMin to catch which module init fails
  const hasEsmMin = /var __esmMin/.test(patched);
  console.log(`[hermes-compat-utils] __esmMin in code: ${hasEsmMin}, code length: ${patched.length}`);
  patched = patched.replace(
    /var __esmMin = \(fn, res\)=>\(\)=>\(fn && \(res = fn\(fn = 0\)\), res\);/,
    `var __esmMin_debug_last = "";
    var __esmMin = function(fn, res) { return function() { if (fn) { try { res = fn(fn = 0); } catch(e) { console.error("[ESMMIN] Failed after: " + __esmMin_debug_last); console.error("[ESMMIN] " + e.message); console.error("[ESMMIN] " + (e.stack || "")); throw e; } } return res; }; };`,
  );

  // DEBUG: Also patch __commonJSMin for same purpose
  patched = patched.replace(
    /var __commonJSMin = \(cb, mod\)=>\(\)=>\(mod \|\| cb\(\(mod = \{\s*exports: \{\}\s*\}\)\.exports, mod\), mod\.exports\);/,
    `var __commonJSMin = function(cb, mod) { return function() { if (!mod) { try { cb((mod = { exports: {} }).exports, mod); } catch(e) { console.error("[CJSMIN] Failed after: " + __esmMin_debug_last); console.error("[CJSMIN] " + e.message); console.error("[CJSMIN] " + (e.stack || "")); throw e; } } return mod.exports; }; };`,
  );

  return patched;
}

/**
 * Transform code for Hermes compatibility using SWC.
 *
 * Uses ES2020 target to transform only what Hermes doesn't support:
 * - Private class fields (#field) → WeakMap-based polyfill
 *
 * ES2020 avoids SWC's ES5 bug where `(0, module.fn)` comma expressions
 * in conditional contexts are incorrectly replaced with `(void 0)`.
 * Hermes supports ES2015+ natively (classes, arrow functions, etc.).
 */
export async function transformForHermes(code: string): Promise<string> {
  // Quick check: skip SWC if no #private fields exist
  if (!code.includes('#')) {
    return code;
  }

  const swc = await import('@swc/core');
  const result = await swc.transform(code, {
    jsc: {
      parser: { syntax: 'ecmascript' },
      target: 'es2020',
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
 * Applied to both initial bundle output and HMR patches.
 */
export async function applyHermesCompat(code: string): Promise<string> {
  let result = await transformForHermes(code);
  result = patchRolldownRuntime(result);
  return result;
}

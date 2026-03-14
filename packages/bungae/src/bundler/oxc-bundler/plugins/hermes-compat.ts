/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Handles two incompatibilities between Rolldown's output and React Native:
 *
 * 1. ES5 downlevel (Hermes):
 *    Hermes doesn't support class expressions or private fields.
 *    Rolldown generates these when bundling ESM modules (minimum ES2015).
 *    → SWC `renderChunk` with `target: 'es5'` converts them in one pass.
 *
 * 2. Configurable exports (React Native dev mode):
 *    Rolldown's runtime helpers (__exportAll, __copyProps) create module
 *    exports with `configurable: false` (Object.defineProperty default).
 *    React Native's `deepFreezeAndThrowOnMutationInDev` tries to redefine
 *    these properties, causing "property is not configurable" errors.
 *    → Patch __defProp to always set `configurable: true`.
 */

import type { Plugin } from 'rolldown';

/**
 * Patch Rolldown's __defProp to always set configurable: true.
 *
 * Rolldown's runtime uses __defProp (= Object.defineProperty) to create
 * module exports, but doesn't set configurable: true. React Native's
 * deepFreezeAndThrowOnMutationInDev needs configurable properties to
 * add mutation-throwing setters in dev mode.
 */
function patchRolldownRuntime(code: string): string {
  // Replace: var __defProp = Object.defineProperty;
  // With: a wrapper that forces configurable: true
  let patched = code.replace(
    /var __defProp = Object\.defineProperty;/,
    `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
  );
  if (patched === code) {
    console.warn(
      '[hermes-compat] Failed to patch __defProp — Rolldown runtime pattern may have changed. ' +
        'React Native dev mode may show "property is not configurable" errors.',
    );
  }

  // DEBUG: Patch __esmMin to catch which module init fails
  const hasEsmMin = /var __esmMin/.test(patched);
  console.log(`[hermes-compat-plugin] __esmMin in code: ${hasEsmMin}, code length: ${patched.length}`);
  patched = patched.replace(
    /var __esmMin = \(fn, res\)=>\(\)=>\(fn && \(res = fn\(fn = 0\)\), res\);/,
    `var __esmMin_debug_last = "";
var __esmMin = function(fn, res) {
  var wrapper = function() {
    if (fn) {
      try {
        res = fn(fn = 0);
      } catch(e) {
        console.error("[ESMMIN DEBUG] Module init failed. Last successful: " + __esmMin_debug_last);
        console.error("[ESMMIN DEBUG] Error: " + e.message);
        console.error("[ESMMIN DEBUG] Stack: " + (e.stack || "no stack"));
        throw e;
      }
    }
    return res;
  };
  return wrapper;
};`,
  );

  return patched;
}

export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    renderChunk: {
      async handler(code, _chunk) {
        try {
          const swc = await import('@swc/core');

          // Use ES2020 target instead of ES5. Hermes supports ES2015+
          // (arrow functions, classes, template literals, destructuring, etc.).
          // The only feature Hermes lacks is private class fields (#field),
          // which are ES2022. ES2020 target transforms only what's needed
          // while avoiding SWC's ES5 bug where `(0, module.fn)` comma
          // expressions in conditional contexts are incorrectly replaced
          // with `(void 0)`.
          const result = await swc.transform(code, {
            jsc: {
              parser: {
                syntax: 'ecmascript',
              },
              target: 'es2020',
              assumptions: {
                setPublicClassFields: true,
                privateFieldsAsProperties: true,
              },
            },
            sourceMaps: true,
          });

          // Patch Rolldown runtime for React Native compatibility
          let patched = patchRolldownRuntime(result.code);

          // DEBUG: Add logging around BatchedBridge's MessageQueue initialization
          patched = patched.replace(
            /MessageQueue = \(init_MessageQueue\(\), __toCommonJS\(MessageQueue_exports\)\)\.default;\s*BatchedBridge\$3 = new MessageQueue\(\);/,
            `MessageQueue = (init_MessageQueue(), __toCommonJS(MessageQueue_exports)).default;
console.error("[DEBUG BatchedBridge] MessageQueue value:", typeof MessageQueue, MessageQueue);
console.error("[DEBUG BatchedBridge] MessageQueue_exports:", typeof MessageQueue_exports, Object.keys(MessageQueue_exports || {}));
try { console.error("[DEBUG BatchedBridge] MessageQueue_exports.default:", typeof (MessageQueue_exports && MessageQueue_exports.default)); } catch(e) { console.error("[DEBUG BatchedBridge] .default access failed:", e.message); }
BatchedBridge$3 = new MessageQueue();`,
          );

          return {
            code: patched,
            map: result.map || undefined,
          };
        } catch (error: any) {
          console.warn(
            `[hermes-compat] SWC transform failed, returning original code: ${error.message}`,
          );
          return null;
        }
      },
    },
  };
}

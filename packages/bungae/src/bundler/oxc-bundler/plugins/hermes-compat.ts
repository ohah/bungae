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

          // DEBUG: Check if void 0 callee exists BEFORE SWC
          const voidBeforeCount = (code.match(/\(void 0\)\(/g) || []).length;
          if (voidBeforeCount > 0) {
            console.warn(`[hermes-compat] BEFORE SWC: found ${voidBeforeCount} "(void 0)(" patterns`);
          }

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

          // DEBUG: Check if void 0 callee exists AFTER SWC
          const voidAfterCount = (result.code.match(/\(void 0\)\(/g) || []).length;
          if (voidAfterCount > 0) {
            console.warn(`[hermes-compat] AFTER SWC: found ${voidAfterCount} "(void 0)(" patterns`);
          }
          if (voidAfterCount > voidBeforeCount) {
            console.warn(`[hermes-compat] ⚠️ SWC introduced ${voidAfterCount - voidBeforeCount} new "(void 0)(" — this is likely the bug!`);
          }

          // Patch Rolldown runtime for React Native compatibility
          let patched = patchRolldownRuntime(result.code);

          // DEBUG: Use function replacement to avoid $1 interpretation issues
          patched = patched.replace(
            /MessageQueue\$1 = class MessageQueue\$11 \{/,
            function() { return 'MessageQueue$1 = class MessageQueue$11 {\n        /* DEBUG_MQ_ASSIGNED */'; }
          );

          // Add logging after class closing, before factory end
          patched = patched.replace(
            /\/\* DEBUG_MQ_ASSIGNED \*\//,
            function() { return ''; }
          );

          // Patch the BatchedBridge init with function replacer (avoids $1/$3 issues)
          patched = patched.replace(
            /MessageQueue = \(init_MessageQueue\(\), __toCommonJS\(MessageQueue_exports\)\)\.default;\s*BatchedBridge\$3 = new MessageQueue\(\);/,
            function() {
              return [
                'init_MessageQueue();',
                'console.error("[DEBUG BB] MessageQueue$" + "1:", typeof MessageQueue$1, MessageQueue$1 != null ? "exists" : "NULL");',
                'console.error("[DEBUG BB] exports.default getter:", typeof MessageQueue_exports.default, MessageQueue_exports.default != null ? "exists" : "NULL");',
                'console.error("[DEBUG BB] exports obj:", JSON.stringify(Object.getOwnPropertyNames(MessageQueue_exports)));',
                'var _desc = Object.getOwnPropertyDescriptor(MessageQueue_exports, "default");',
                'if (_desc && _desc.get) { console.error("[DEBUG BB] getter result:", typeof _desc.get(), _desc.get()); }',
                'MessageQueue = (init_MessageQueue(), __toCommonJS(MessageQueue_exports)).default;',
                'console.error("[DEBUG BB] final MessageQueue:", typeof MessageQueue);',
                'BatchedBridge$3 = new MessageQueue();',
              ].join('\n');
            }
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

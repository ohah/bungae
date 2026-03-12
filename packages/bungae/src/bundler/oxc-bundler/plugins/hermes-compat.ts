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
  const patched = code.replace(
    /var __defProp = Object\.defineProperty;/,
    `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
  );
  if (patched === code) {
    console.warn(
      '[hermes-compat] Failed to patch __defProp — Rolldown runtime pattern may have changed. ' +
        'React Native dev mode may show "property is not configurable" errors.',
    );
  }
  return patched;
}

export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    renderChunk: {
      async handler(code, _chunk) {
        try {
          const swc = await import('@swc/core');

          const result = await swc.transform(code, {
            jsc: {
              parser: {
                syntax: 'ecmascript',
              },
              target: 'es5',
              assumptions: {
                setPublicClassFields: true,
                privateFieldsAsProperties: true,
              },
            },
            sourceMaps: true,
          });

          // Patch Rolldown runtime for React Native compatibility
          const patched = patchRolldownRuntime(result.code);

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

/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Two separate concerns, handled at different stages:
 *
 * 1. ES5 downlevel — `transform` hook (per-module, before bundling):
 *    Hermes doesn't support class expressions, private fields, optional
 *    chaining, nullish coalescing, etc. SWC `target: 'es5'` converts
 *    each module individually. Per-module transform avoids SWC bugs that
 *    occur when transforming the entire 4MB+ bundle chunk at once.
 *
 * 2. Configurable exports — `renderChunk` hook (post-bundling):
 *    Rolldown's runtime helpers create module exports with
 *    `configurable: false`. React Native's deepFreezeAndThrowOnMutationInDev
 *    needs `configurable: true` to add mutation-throwing setters in dev mode.
 *    → Patch __defProp in the final chunk.
 */

import type { Plugin } from 'rolldown';

let swcModule: typeof import('@swc/core') | null = null;

async function getSwc() {
  if (!swcModule) {
    swcModule = await import('@swc/core');
  }
  return swcModule;
}

/**
 * Per-module SWC es5 transform for Hermes compatibility.
 * Runs in `transform` hook — each module is small, fast, and isolated
 * from Rolldown's runtime code.
 */
export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    transform: {
      filter: {
        id: {
          exclude: [/\.json$/],
        },
      },
      async handler(code, id) {
        // Skip non-JS modules
        if (!id.match(/\.[jt]sx?$|\.mjs$|\.cjs$/)) return null;

        try {
          const swc = await getSwc();

          const result = await swc.transform(code, {
            filename: id,
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

          return {
            code: result.code,
            map: result.map || undefined,
          };
        } catch {
          // If SWC fails (e.g., syntax not supported), pass through unchanged
          return null;
        }
      },
    },

    renderChunk: {
      handler(code, _chunk) {
        // Patch Rolldown's __defProp to always set configurable: true.
        // This only touches Rolldown's runtime (first few lines of the chunk),
        // not user/library code.
        const patched = code.replace(
          /var __defProp = Object\.defineProperty;/,
          `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
        );
        if (patched === code) {
          console.warn(
            '[hermes-compat] Failed to patch __defProp — Rolldown runtime pattern may have changed.',
          );
        }

        return { code: patched };
      },
    },
  };
}

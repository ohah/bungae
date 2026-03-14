/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * 1. Per-module SWC es5 transform (`transform` hook):
 *    Hermes doesn't support class expressions or private fields.
 *    SWC `target: 'es5'` converts each module individually.
 *    React Native internal modules (already Babel-processed by flow-strip)
 *    are excluded to avoid breaking their scoping semantics.
 *
 * 2. Configurable exports (`renderChunk` hook):
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
 * Modules that should NOT be SWC-transformed.
 * These are processed by flow-strip (Babel) and rely on let/const scoping.
 */
const SKIP_PATTERNS = [
  /node_modules\/react-native\//,
  /node_modules\/react\//,
  /node_modules\/@react-native\//,
  /node_modules\/metro-runtime\//,
  /node_modules\/scheduler\//,
];

function shouldSkipTransform(id: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(id));
}

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
        if (!id.match(/\.[jt]sx?$|\.mjs$|\.cjs$/)) return null;
        if (shouldSkipTransform(id)) return null;

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
          return null;
        }
      },
    },

    renderChunk: {
      handler(code, _chunk) {
        // Patch Rolldown's __defProp to always set configurable: true.
        const patched = code.replace(
          /var __defProp = Object\.defineProperty;/,
          `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
        );

        return { code: patched };
      },
    },
  };
}

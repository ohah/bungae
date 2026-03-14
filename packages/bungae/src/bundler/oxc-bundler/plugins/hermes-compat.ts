/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * 1. Private fields downlevel — `transform` hook (per-module):
 *    Hermes (0.83) supports class expressions but NOT private fields (#field).
 *    SWC `target: 'es2015'` transforms only private fields/methods to
 *    regular properties, while preserving let/const, arrow functions,
 *    class expressions, template literals, etc.
 *
 * 2. Configurable exports — `renderChunk` hook (post-bundling):
 *    Rolldown's runtime helpers create module exports with
 *    `configurable: false`. Patch __defProp to set `configurable: true`.
 */

import type { Plugin } from 'rolldown';

let swcModule: typeof import('@swc/core') | null = null;

async function getSwc() {
  if (!swcModule) {
    swcModule = await import('@swc/core');
  }
  return swcModule;
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

        // Quick check: skip if no private fields/methods
        if (!code.includes('#')) return null;

        try {
          const swc = await getSwc();

          const result = await swc.transform(code, {
            filename: id,
            jsc: {
              parser: { syntax: 'ecmascript' },
              target: 'es2015',
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

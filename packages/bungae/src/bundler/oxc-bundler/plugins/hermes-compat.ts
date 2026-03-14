/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * 1. ES5 downlevel (`renderChunk`):
 *    Hermes doesn't support class expressions or private fields.
 *    SWC `target: 'es5'` converts the entire chunk in one pass.
 *
 * 2. Configurable exports (`renderChunk`):
 *    Rolldown's runtime helpers create module exports with
 *    `configurable: false`. React Native's deepFreezeAndThrowOnMutationInDev
 *    needs `configurable: true` to add mutation-throwing setters in dev mode.
 *    → Patch __defProp in the final chunk.
 */

import { writeFileSync } from 'fs';

import type { Plugin } from 'rolldown';

export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    renderChunk: {
      async handler(code, _chunk) {
        try {
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
            sourceMaps: true,
          });

          // Patch __defProp for configurable exports
          const patched = result.code.replace(
            /var __defProp = Object\.defineProperty;/,
            `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
          );

          return {
            code: patched,
            map: result.map || undefined,
          };
        } catch (error: any) {
          console.warn(`[hermes-compat] SWC transform failed: ${error.message}`);
          return null;
        }
      },
    },
  };
}

/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Two concerns handled in `renderChunk` (post-bundling):
 *
 * 1. Class expressions → function expressions:
 *    Hermes doesn't support class expressions (`var X = class {}`).
 *    Rolldown generates these when bundling ESM modules.
 *    Uses Babel with only @babel/plugin-transform-classes to avoid
 *    changing let/const/arrow/template-literal scoping semantics.
 *
 * 2. Configurable exports:
 *    Rolldown's runtime helpers create module exports with
 *    `configurable: false`. React Native's deepFreezeAndThrowOnMutationInDev
 *    needs `configurable: true` to add mutation-throwing setters in dev mode.
 *    → Patch __defProp in the final chunk.
 */

import type { Plugin } from 'rolldown';

export function hermesCompatPlugin(): Plugin {
  return {
    name: 'bungae:hermes-compat',

    renderChunk: {
      async handler(code, _chunk) {
        let result = code;

        // 1. Transform class expressions to function expressions for Hermes.
        //    Only @babel/plugin-transform-classes — no other ES5 transforms.
        //    This preserves let/const, arrow functions, template literals, etc.
        try {
          const babel = await import('@babel/core');

          const babelResult = await babel.transformAsync(result, {
            babelrc: false,
            configFile: false,
            sourceType: 'script',
            plugins: [
              '@babel/plugin-transform-classes',
              ['@babel/plugin-transform-class-properties', { loose: true }],
              ['@babel/plugin-transform-private-methods', { loose: true }],
              ['@babel/plugin-transform-private-property-in-object', { loose: true }],
            ],
            assumptions: {
              setPublicClassFields: true,
              privateFieldsAsProperties: true,
            },
            sourceMaps: true,
          });

          if (babelResult?.code) {
            result = babelResult.code;
          }
        } catch (error: any) {
          console.warn(`[hermes-compat] Babel class transform failed: ${error.message}`);
        }

        // 2. Patch Rolldown's __defProp to always set configurable: true.
        result = result.replace(
          /var __defProp = Object\.defineProperty;/,
          `var __defProp = function(obj, key, desc) { desc.configurable = true; return Object.defineProperty(obj, key, desc); };`,
        );

        return { code: result };
      },
    },
  };
}

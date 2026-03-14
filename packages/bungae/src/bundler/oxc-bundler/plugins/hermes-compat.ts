/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Per-module ES5 + JSX transform (`transform` hook):
 *   SWC converts each module individually before Rolldown bundles.
 *   - ES5: class expressions, private fields, let/const, arrow functions
 *   - JSX: automatic runtime (jsx/jsxDEV calls)
 *   By handling JSX here, Rolldown never generates JSX calls, avoiding
 *   the Rolldown bug where (0, jsxDEV) becomes (void 0) in && context.
 *
 * Post-bundling __defProp patch (`renderChunk` hook):
 *   Rolldown's runtime helpers create exports with `configurable: false`.
 *   Patch __defProp to set `configurable: true` for RN dev mode.
 */

import type { Plugin } from 'rolldown';

let swcModule: typeof import('@swc/core') | null = null;

async function getSwc() {
  if (!swcModule) {
    swcModule = await import('@swc/core');
  }
  return swcModule;
}

export function hermesCompatPlugin(dev = true): Plugin {
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

        try {
          const swc = await getSwc();

          const result = await swc.transform(code, {
            filename: id,
            jsc: {
              parser: {
                syntax: id.match(/\.tsx?$/) ? 'typescript' : 'ecmascript',
                tsx: id.endsWith('.tsx'),
                jsx: id.endsWith('.jsx'),
              },
              target: 'es2015',
              transform: {
                react: {
                  runtime: 'automatic',
                  development: dev,
                  refresh: false,
                },
              },
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

/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Post-bundling ES5 downlevel via SWC `renderChunk`:
 * Converts class expressions, private fields, let/const, arrow functions, etc.
 * so the output runs on Hermes (which lacks full ES6+ support).
 */

import type { Plugin } from 'rolldown';

export function hermesCompatPlugin(): Plugin {
  let swc: typeof import('@swc/core') | null = null;

  return {
    name: 'bungae:hermes-compat',

    renderChunk: {
      async handler(code, _chunk) {
        try {
          if (!swc) {
            swc = await import('@swc/core');
          }

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

          return {
            code: result.code,
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

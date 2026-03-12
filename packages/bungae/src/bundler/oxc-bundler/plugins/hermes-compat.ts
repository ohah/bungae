/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Hermes engine doesn't support:
 * - Class expressions (`var Foo = class Foo {}`)
 * - Private class fields (`#field`)
 *
 * Rolldown generates class expressions when bundling ESM modules,
 * and doesn't support ES5 target natively (minimum is ES2015).
 *
 * Solution: SWC `renderChunk` with `target: 'es5'` to convert
 * class → function and private fields → properties in one pass
 * on the final bundle output (~200ms for 4MB bundle).
 */

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

          return {
            code: result.code,
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

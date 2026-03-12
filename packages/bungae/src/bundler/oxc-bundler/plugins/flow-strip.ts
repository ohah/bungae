/**
 * Flow Strip Plugin for Rolldown
 *
 * Strips Flow type annotations from JavaScript files.
 * Uses hermes-parser for accurate Flow parsing + Babel for type stripping.
 *
 * Only processes files that contain Flow syntax (@flow pragma or Flow-specific syntax).
 * TypeScript files are handled natively by Rolldown/OXC.
 */

import type { Plugin } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';

/**
 * Check if code contains Flow syntax
 */
export function containsFlowSyntax(code: string): boolean {
  // @flow pragma (most common)
  if (/\/[/*]\s*@flow/.test(code)) return true;
  // Flow-specific keywords
  if (/\bopaque\s+type\b/.test(code)) return true;
  if (/\bdeclare\s+(module|class|function|var|type|interface|export)\b/.test(code)) return true;
  return false;
}

export function flowStripPlugin(config: ResolvedConfig): Plugin {
  let babel: typeof import('@babel/core') | null = null;

  return {
    name: 'bungae:flow-strip',

    transform: {
      filter: { id: /\.[cm]?jsx?$/ },
      async handler(code, id) {
        // Skip node_modules Flow files that don't have Flow pragma
        // (they might have been pre-compiled)
        if (!containsFlowSyntax(code)) return null;

        // Skip .flow.js definition files
        if (id.endsWith('.flow.js') || id.endsWith('.flow')) return null;

        // Lazy load Babel
        if (!babel) {
          babel = await import('@babel/core');
        }

        const result = await babel.transformAsync(code, {
          filename: id,
          babelrc: false,
          configFile: false,
          sourceMaps: true,
          plugins: [
            [
              require.resolve('babel-plugin-syntax-hermes-parser'),
              {
                parseLangTypes: 'flow',
                reactRuntimeTarget: '19',
              },
            ],
            require.resolve('@babel/plugin-transform-flow-strip-types'),
          ],
        });

        if (!result?.code) return null;

        return {
          code: result.code,
          map: result.map ?? undefined,
        };
      },
    },
  };
}

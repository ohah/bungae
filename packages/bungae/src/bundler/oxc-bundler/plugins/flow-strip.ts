/**
 * Flow Strip Plugin for Rolldown
 *
 * Strips Flow type annotations from JavaScript files.
 * Uses hermes-parser for accurate Flow parsing + Babel for type stripping.
 *
 * IMPORTANT: Must use `load` hook (not `transform`) because Rolldown/OXC
 * cannot parse Flow syntax. The file must be transformed BEFORE Rolldown
 * attempts to parse it.
 *
 * Only processes .js/.jsx files (TypeScript is handled natively by OXC).
 */

import { readFileSync } from 'fs';

import type { Plugin } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';

/**
 * Check if code contains Flow syntax
 */
export function containsFlowSyntax(code: string): boolean {
  // @flow pragma (most common) - matches both:
  // // @flow
  // /* @flow */
  // * @flow strict-local  (inside JSDoc block comment)
  if (/@flow\b/.test(code)) return true;
  // Flow-specific keywords
  if (/\bopaque\s+type\b/.test(code)) return true;
  if (/\bdeclare\s+(module|class|function|var|type|interface|export)\b/.test(code)) return true;
  return false;
}

export function flowStripPlugin(_config: ResolvedConfig): Plugin {
  let babel: typeof import('@babel/core') | null = null;

  return {
    name: 'bungae:flow-strip',

    // Use `load` hook to transform Flow BEFORE Rolldown parses the file.
    async load(id: string) {
      // Only process JS/JSX files (not TS/TSX - OXC handles those)
      if (!/\.[cm]?jsx?$/.test(id)) return null;

      // Skip .flow.js definition files
      if (id.endsWith('.flow.js') || id.endsWith('.flow')) {
        return { code: 'export {};', moduleType: 'js' };
      }

      // Read file and check for Flow syntax
      let code: string;
      try {
        code = readFileSync(id, 'utf-8');
      } catch {
        return null;
      }

      if (!containsFlowSyntax(code)) return null;

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
        map: result.map ? JSON.stringify(result.map) : undefined,
        moduleType: 'jsx', // Treat as JSX since Flow files may contain JSX
      };
    },
  };
}

/**
 * HMR Client Replace Plugin
 *
 * Replaces React Native's built-in HMRClient.js with Bungae's custom
 * HMR client implementation that uses the Rolldown DevEngine protocol.
 *
 * React Native's HMRClient uses Metro's HMR protocol which is incompatible
 * with Rolldown's ESM scope-hoisted output. This plugin intercepts the
 * module load and returns Bungae's custom client instead.
 */

import { readFileSync } from 'fs';

import type { Plugin } from 'rolldown';

const HMR_CLIENT_PATTERN = /react-native[/\\]Libraries[/\\]Utilities[/\\]HMRClient/;

/**
 * Compile the HMR client TypeScript source to JavaScript.
 * Cached after first compilation.
 */
let compiledClientCode: string | null = null;

async function getCompiledHmrClient(): Promise<string> {
  if (compiledClientCode != null) return compiledClientCode;

  const clientSource = readFileSync(require.resolve('../hmr/hmr-client'), 'utf-8');

  const transpiler = new Bun.Transpiler({
    loader: 'ts',
    target: 'browser',
  });

  compiledClientCode = transpiler.transformSync(clientSource);
  return compiledClientCode;
}

export function hmrClientReplacePlugin(): Plugin {
  return {
    name: 'bungae:hmr-client-replace',

    load: {
      filter: {
        id: {
          include: [HMR_CLIENT_PATTERN],
        },
      },
      async handler(_id) {
        return {
          code: await getCompiledHmrClient(),
          moduleType: 'js',
        };
      },
    },
  };
}

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
import { transformSync } from 'rolldown/experimental';

const HMR_CLIENT_PATTERN =
  /metro-runtime[/\\]src[/\\]modules[/\\]HMRClient|react-native[/\\]Libraries[/\\]Utilities[/\\]HMRClient/;

/**
 * Compile the HMR client TypeScript source to JavaScript.
 * Cached after first compilation.
 */
let compiledClientCode: string | null = null;

function getCompiledHmrClient(): string {
  if (compiledClientCode != null) return compiledClientCode;

  const clientSource = readFileSync(require.resolve('../hmr/hmr-client'), 'utf-8');
  const result = transformSync('hmr-client.ts', clientSource, {
    sourcemap: false,
  });

  compiledClientCode = result.code;
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
      handler(_id) {
        return {
          code: getCompiledHmrClient(),
          moduleType: 'js',
        };
      },
    },
  };
}

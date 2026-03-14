/**
 * Babel Plugins Bridge for Rolldown
 *
 * Runs user-configured Babel plugins as a Rolldown transform hook.
 * This allows using Babel plugins that require AST-level transforms
 * not supported by OXC/Rolldown (e.g., react-native-reanimated/plugin).
 *
 * Only processes files matching the include pattern and skips node_modules
 * unless the plugin specifically needs it.
 */

import type { Plugin } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';

type BabelPluginEntry = string | [string, Record<string, unknown>];

const INCLUDE_REGEX = /\.[cm]?[jt]sx?$/;
const EXCLUDE_REGEX = /\/node_modules\//;

export function babelPluginsPlugin(config: ResolvedConfig): Plugin | null {
  const babelPlugins = config.transformer.babelPlugins;
  if (!babelPlugins || babelPlugins.length === 0) return null;

  let babel: typeof import('@babel/core') | null = null;

  // Resolve plugin entries to Babel format.
  // Search both the project root and bungae's own node_modules.
  const resolvePaths = [config.root, __dirname];
  const resolvedPlugins = babelPlugins.map((entry: BabelPluginEntry) => {
    if (typeof entry === 'string') {
      return require.resolve(entry, { paths: resolvePaths });
    }
    const [name, options] = entry;
    return [require.resolve(name, { paths: resolvePaths }), options];
  });

  return {
    name: 'bungae:babel-plugins',

    async transform(code, id) {
      if (!INCLUDE_REGEX.test(id)) return null;
      if (EXCLUDE_REGEX.test(id)) return null;

      // Lazy load Babel
      if (!babel) {
        babel = await import('@babel/core');
      }

      const result = await babel.transformAsync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        plugins: resolvedPlugins,
      });

      if (!result?.code) return null;

      return {
        code: result.code,
        map: result.map ? JSON.stringify(result.map) : undefined,
      };
    },
  };
}

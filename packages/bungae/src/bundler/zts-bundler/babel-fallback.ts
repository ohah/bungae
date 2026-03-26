/**
 * Babel Fallback for ZTS Bundler
 *
 * Creates a callback for ZTS NAPI that runs user-configured Babel plugins
 * (e.g., reanimated/plugin) on files that need them.
 */

import type { ResolvedConfig } from '../../config/types';

/**
 * Create a Babel transform callback for ZTS NAPI.
 * Returns undefined if no user Babel plugins are configured.
 */
export function createBabelTransformCallback(
  config: ResolvedConfig,
): ((filePath: string, code: string) => string | null) | undefined {
  const babelConfig = config.transformer?.babel;

  if (
    !babelConfig ||
    (!babelConfig.plugins?.length && !babelConfig.presets?.length)
  ) {
    return undefined;
  }

  const { presets = [], plugins = [] } = babelConfig;
  const { platform } = config;

  return (filePath: string, code: string): string | null => {
    if (filePath.includes('node_modules')) return null;

    try {
      const babel = require('@babel/core');

      const result = babel.transformSync(code, {
        filename: filePath,
        babelrc: false,
        configFile: false,
        presets,
        plugins,
        sourceMaps: false,
        caller: {
          name: 'bungae-zts',
          bundler: 'bungae',
          platform,
        },
      });

      return result?.code ?? null;
    } catch (error: any) {
      console.warn(`  Babel fallback failed for ${filePath}: ${error.message}`);
      return null;
    }
  };
}

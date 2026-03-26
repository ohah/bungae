/**
 * Babel Fallback for ZTS Bundler
 *
 * Creates a callback that ZTS calls when a file needs Babel processing
 * (e.g., user-configured plugins like reanimated/plugin).
 * Returns null for files that don't need Babel, so ZTS handles them natively.
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

  // No Babel plugins configured — skip Babel entirely
  if (
    !babelConfig ||
    (!babelConfig.plugins?.length && !babelConfig.presets?.length)
  ) {
    return undefined;
  }

  // Return a callback that runs Babel with user plugins
  return (filePath: string, code: string): string | null => {
    // Skip node_modules (user plugins are for app code)
    if (filePath.includes('node_modules')) return null;

    try {
      // Lazy-load Babel to avoid import cost when not needed
      const babel = require('@babel/core');

      const result = babel.transformSync(code, {
        filename: filePath,
        babelrc: false,
        configFile: false,
        presets: babelConfig.presets || [],
        plugins: babelConfig.plugins || [],
        sourceMaps: false,
        caller: {
          name: 'bungae-zts',
          bundler: 'bungae',
          platform: config.platform,
        },
      });

      return result?.code ?? null;
    } catch (error: any) {
      console.warn(`  Babel fallback failed for ${filePath}: ${error.message}`);
      return null;
    }
  };
}

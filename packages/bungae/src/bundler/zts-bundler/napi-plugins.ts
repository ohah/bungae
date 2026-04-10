/**
 * ZTS NAPI Plugin Factories
 *
 * Creates ZtsPlugin instances for in-process NAPI build/watch.
 * Uses shared logic from plugin-core.ts (no IPC, no subprocess).
 */

import type { ZtsPlugin } from '@zts/core';
import {
  ASSET_REGISTRY_CODE,
  ASSET_REGISTRY_SPECIFIERS,
  ZTS_HMR_CLIENT_CODE,
  HMR_CLIENT_SUFFIX,
  generateAssetCode,
  detectCustomPlugins,
  createBabelTransformer,
  escapeRegex,
} from './plugin-core';

export interface PluginConfig {
  projectRoot: string;
  assetExts: string[];
  rnPlatform: 'ios' | 'android';
  sourceExts: string[];
}

/**
 * React Native asset plugin for NAPI build.
 *
 * Handles:
 * - AssetRegistry import redirection to virtual module
 * - HMRClient.js replacement with ZTS HMR client
 * - Asset files (.png, .jpg, etc.) -> registerAsset() code generation
 */
export function createAssetPlugin(config: PluginConfig): ZtsPlugin {
  return {
    name: 'bungae:react-native-asset',
    setup(build) {
      // onResolve: redirect AssetRegistry imports to virtual module
      // Both specifiers point to the same virtual module (single assets array)
      const registryPattern = new RegExp(
        ASSET_REGISTRY_SPECIFIERS.map((s) => escapeRegex(s)).join('|'),
      );
      build.onResolve({ filter: registryPattern }, () => ({
        path: '\0bungae:asset-registry',
      }));

      // onLoad: virtual modules (asset-registry, hmr-client)
      build.onLoad({ filter: /\0bungae:/ }, (args) => {
        if (args.path === '\0bungae:asset-registry') {
          return { contents: ASSET_REGISTRY_CODE };
        }
        if (args.path === '\0bungae:hmr-client') {
          return { contents: ZTS_HMR_CLIENT_CODE };
        }
        return null;
      });

      // onLoad: HMRClient.js replacement — intercept Metro's HMRClient with ZTS version
      const hmrClientPattern = new RegExp(
        escapeRegex(HMR_CLIENT_SUFFIX) + '$',
      );
      build.onLoad({ filter: hmrClientPattern }, () => ({
        contents: ZTS_HMR_CLIENT_CODE,
      }));

      // onLoad: asset files (.png, .jpg, etc.) -> Metro-compatible registerAsset() code
      const extPatterns = config.assetExts
        .map((e) => e.replace(/^\./, ''))
        .join('|');
      const assetPattern = new RegExp(`\\.(${extPatterns})$`);

      build.onLoad({ filter: assetPattern }, (args) => ({
        contents: generateAssetCode(args.path, {
          projectRoot: config.projectRoot,
          platform: config.rnPlatform,
        }),
      }));
    },
  };
}

/**
 * Babel transform plugin for NAPI build.
 *
 * Runs user-configured Babel plugins (reanimated, nativewind, worklet) on source files.
 * Only activates when custom plugins are detected in babel.config.js.
 * Babel is lazy-loaded on first transform to avoid startup latency.
 */
export function createBabelPlugin(config: PluginConfig): ZtsPlugin {
  return {
    name: 'bungae:babel-transform',
    setup(build) {
      // Skip entirely if no custom Babel plugins detected
      if (!detectCustomPlugins(config.projectRoot)) return;

      const transformer = createBabelTransformer(config.projectRoot);

      const extPatterns = config.sourceExts
        .map((e) => e.replace(/^\./, ''))
        .join('|');
      const sourcePattern = new RegExp(`\\.(${extPatterns})$`);

      build.onTransform({ filter: sourcePattern }, (args) => {
        // Skip node_modules — custom plugins only apply to user code
        if (args.path.includes('node_modules')) return null;

        try {
          const result = transformer(args.code, args.path);
          return result ? { code: result } : null;
        } catch {
          // Babel errors are logged by the transformer; don't break the build
          return null;
        }
      });
    },
  };
}

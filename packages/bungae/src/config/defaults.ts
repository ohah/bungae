/**
 * Default configuration values
 */

import type {
  ResolvedConfig,
  ResolverConfig,
  TransformerConfig,
  SerializerConfig,
  ServerConfig,
} from './types';

/**
 * Default resolver configuration
 */
export const DEFAULT_RESOLVER: Required<ResolverConfig> = {
  sourceExts: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
  assetExts: ['.bmp', '.gif', '.jpg', '.jpeg', '.png', '.webp', '.avif', '.ico', '.icns', '.icxl'],
  platforms: ['ios', 'android', 'native'],
  preferNativePlatform: true,
  nodeModulesPaths: [],
  blockList: [],
};

/**
 * Default transformer configuration
 */
export const DEFAULT_TRANSFORMER: Required<TransformerConfig> = {
  minifier: 'bun',
  inlineRequires: false,
};

/**
 * Default serializer configuration
 * Metro's default getModulesRunBeforeMainModule returns an empty array
 * React Native's @react-native/metro-config getDefaultConfig includes InitializeCore
 * This matches React Native's default behavior
 */
export const DEFAULT_SERIALIZER: Required<SerializerConfig> = {
  polyfills: [],
  prelude: [],
  bundleType: 'plain',
  extraVars: {},
  getModulesRunBeforeMainModule: (entryFilePath: string) => {
    // Match React Native's @react-native/metro-config default behavior
    // It includes InitializeCore (but not ReactNativePrivateInitializeCore)
    const modules: string[] = [];

    // Get entry file directory for path resolution
    const { dirname } = require('path');
    const entryDir = dirname(entryFilePath);

    try {
      // React Native's getDefaultConfig includes InitializeCore
      const initializeCore = require.resolve('react-native/Libraries/Core/InitializeCore', {
        paths: [entryDir],
      });
      modules.push(initializeCore);
    } catch {
      // Not a React Native project or module not found
    }

    return modules;
  },
  getPolyfills: () => [],
};

/**
 * Default server configuration
 */
export const DEFAULT_SERVER: Required<ServerConfig> = {
  port: 8081,
  useGlobalHotkey: true,
  forwardClientLogs: true,
  verifyConnections: false,
  unstable_serverRoot: null,
};

/**
 * Get default configuration
 */
export default function getDefaultConfig(root: string = process.cwd()): ResolvedConfig {
  return {
    root,
    entry: 'index.js',
    platform: 'ios',
    dev: false,
    minify: false,
    outDir: 'dist',
    mode: 'production',
    resolver: { ...DEFAULT_RESOLVER },
    transformer: { ...DEFAULT_TRANSFORMER },
    serializer: { ...DEFAULT_SERIALIZER },
    server: { ...DEFAULT_SERVER },
  };
}

// Named export for backward compatibility
export { getDefaultConfig };

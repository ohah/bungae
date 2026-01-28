/**
 * Default configuration values
 */

import type {
  ResolvedConfig,
  ResolverConfig,
  TransformerConfig,
  SerializerConfig,
  ServerConfig,
  ExperimentalConfig,
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
 * Metro uses Terser by default for minification
 */
export const DEFAULT_TRANSFORMER: Required<TransformerConfig> = {
  minifier: 'terser', // Metro-compatible: Metro uses Terser by default
  inlineRequires: false,
};

/**
 * Default experimental configuration
 */
export const DEFAULT_EXPERIMENTAL: Required<ExperimentalConfig> = {
  treeShaking: false, // Disabled by default (experimental feature)
};

/**
 * Default serializer configuration
 * Metro's default getModulesRunBeforeMainModule returns an empty array
 * React Native's @react-native/metro-config getDefaultConfig includes InitializeCore
 * This matches React Native's default behavior
 */
export const DEFAULT_SERIALIZER: Required<Omit<SerializerConfig, 'shouldAddToIgnoreList'>> & {
  shouldAddToIgnoreList?: SerializerConfig['shouldAddToIgnoreList'];
} = {
  polyfills: [],
  prelude: [],
  bundleType: 'plain',
  extraVars: {},
  getModulesRunBeforeMainModule: (
    entryFilePath: string,
    options?: { projectRoot: string; nodeModulesPaths: string[] },
  ) => {
    // Match React Native's @react-native/metro-config default behavior
    // It includes InitializeCore (but not ReactNativePrivateInitializeCore)
    const modules: string[] = [];

    // Get entry file directory for path resolution
    const { dirname, resolve } = require('path');
    const entryDir = dirname(entryFilePath);
    const projectRoot = options?.projectRoot || entryDir;

    // Build paths array for require.resolve (Metro-compatible monorepo support)
    // Metro checks: entryDir, projectRoot, projectRoot/node_modules, and all nodeModulesPaths
    const resolvePaths: string[] = [entryDir, projectRoot];

    // Add projectRoot/node_modules
    try {
      const projectNodeModules = resolve(projectRoot, 'node_modules');
      resolvePaths.push(projectNodeModules);
    } catch {
      // Ignore if resolve fails
    }

    // Add all nodeModulesPaths (for monorepo support)
    if (options?.nodeModulesPaths) {
      for (const nodeModulesPath of options.nodeModulesPaths) {
        // nodeModulesPath can be relative (to projectRoot) or absolute
        const absolutePath = require('path').isAbsolute(nodeModulesPath)
          ? nodeModulesPath
          : resolve(projectRoot, nodeModulesPath);
        resolvePaths.push(absolutePath);
      }
    }

    try {
      // React Native's getDefaultConfig includes InitializeCore
      // Metro resolves using all paths in order (monorepo support)
      const initializeCore = require.resolve('react-native/Libraries/Core/InitializeCore', {
        paths: resolvePaths,
      });
      modules.push(initializeCore);
    } catch {
      // Not a React Native project or module not found
    }

    return modules;
  },
  getPolyfills: () => [],
  inlineSourceMap: false,
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
    bundler: 'graph', // Default: Babel-based bundler (Metro-compatible, stable)
    resolver: { ...DEFAULT_RESOLVER },
    transformer: { ...DEFAULT_TRANSFORMER },
    serializer: { ...DEFAULT_SERIALIZER },
    server: { ...DEFAULT_SERVER },
    experimental: { ...DEFAULT_EXPERIMENTAL },
  };
}

// Named export for backward compatibility
export { getDefaultConfig };

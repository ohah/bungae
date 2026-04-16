/**
 * Default configuration values
 */

import type {
  ResolvedConfig,
  ResolverConfig,
  TransformerConfig,
  SerializerConfig,
  ServerConfig,
  SymbolicatorConfig,
  ExperimentalConfig,
} from './types';

/**
 * Default resolver configuration
 */
export const DEFAULT_RESOLVER: Required<Omit<ResolverConfig, 'resolveRequest'>> = {
  sourceExts: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
  assetExts: [
    // 이미지 (Metro defaults + 추가)
    '.bmp',
    '.gif',
    '.jpg',
    '.jpeg',
    '.png',
    '.psd',
    '.svg',
    '.webp',
    '.tiff',
    '.tif',
    '.xml',
    '.avif',
    '.ico',
    // 비디오
    '.m4v',
    '.mov',
    '.mp4',
    '.mpeg',
    '.mpg',
    '.webm',
    // 오디오
    '.aac',
    '.aiff',
    '.caf',
    '.m4a',
    '.mp3',
    '.wav',
    // 문서
    '.html',
    '.pdf',
    '.yaml',
    '.yml',
    // 폰트
    '.otf',
    '.ttf',
    '.woff',
    '.woff2',
  ],
  platforms: ['ios', 'android', 'native'],
  preferNativePlatform: true,
  nodeModulesPaths: [],
  blockList: [],
  extraNodeModules: {},
};

/**
 * Default transformer configuration
 * Metro uses Terser by default for minification
 */
export const DEFAULT_TRANSFORMER: Required<TransformerConfig> = {
  minifier: 'terser', // Metro-compatible: Metro uses Terser by default
  inlineRequires: false,
  babelTransformerPath: '',
  babel: { presets: [], plugins: [] },
};

/**
 * Default experimental configuration
 */
export const DEFAULT_EXPERIMENTAL: Required<ExperimentalConfig> = {
  treeShaking: false, // Disabled by default (experimental feature)
};

/**
 * Default symbolicator configuration (Metro 호환).
 * customizeFrame: noop returning undefined (no collapse).
 */
export const DEFAULT_SYMBOLICATOR: Required<SymbolicatorConfig> = {
  customizeFrame: () => undefined,
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
  host: 'localhost',
  https: false,
  key: '',
  cert: '',
  useGlobalHotkey: true,
  forwardClientLogs: true,
  verifyConnections: false,
  unstable_serverRoot: null,
  // Metro 호환: identity wrapper. 사용자가 override하지 않으면 그대로 통과.
  enhanceMiddleware: (middleware) => middleware,
  // Metro 호환: identity. URL 재작성 안 함.
  rewriteRequestUrl: (url) => url,
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

    // Build output options (all optional at CLI level, but required in ResolvedConfig)
    bundleOutput: '',
    sourcemapOutput: '',
    sourcemapSourcesRoot: '',
    sourcemapUseAbsolutePath: false,
    sourceMap: false,
    sourceMapUrl: '',
    assetsDest: '',
    assetCatalogDest: '',
    bundleEncoding: 'utf8',
    resetCache: false,
    maxWorkers: 0, // 0 = auto (use available CPUs)
    watchFolders: [],
    sourceExts: [],
    transformOptions: {},
    resolverOptions: {},
    unstableTransformProfile: 'default',
    interactive: true,

    resolver: { ...DEFAULT_RESOLVER },
    transformer: { ...DEFAULT_TRANSFORMER },
    serializer: { ...DEFAULT_SERIALIZER },
    server: { ...DEFAULT_SERVER },
    symbolicator: { ...DEFAULT_SYMBOLICATOR },
    experimental: { ...DEFAULT_EXPERIMENTAL },
  };
}

// Named export for backward compatibility
export { getDefaultConfig };

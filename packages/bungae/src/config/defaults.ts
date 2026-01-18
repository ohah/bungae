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
  babel: {
    include: [],
    plugins: [],
    presets: [],
  },
  minifier: 'bun',
  inlineRequires: false,
};

/**
 * Default serializer configuration
 */
export const DEFAULT_SERIALIZER: Required<SerializerConfig> = {
  polyfills: [],
  prelude: [],
  bundleType: 'plain',
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
// Named export for backward compatibility
export { getDefaultConfig };

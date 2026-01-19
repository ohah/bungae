/**
 * Bungae Configuration Types
 */

export type Platform = 'ios' | 'android' | 'web';
export type Mode = 'development' | 'production';
export type BundleType = 'plain' | 'ram-indexed' | 'ram-file';

/**
 * Resolver configuration
 */
export interface ResolverConfig {
  /** Source file extensions */
  sourceExts?: string[];
  /** Asset file extensions */
  assetExts?: string[];
  /** Supported platforms */
  platforms?: string[];
  /** Prefer .native.js over .js when platform is ios/android */
  preferNativePlatform?: boolean;
  /** Additional node_modules paths */
  nodeModulesPaths?: string[];
  /** Block list patterns */
  blockList?: RegExp[];
}

/**
 * Transformer configuration
 */
export interface TransformerConfig {
  /** Minifier to use */
  minifier?: 'bun' | 'terser' | 'esbuild';
  /** Enable inline requires */
  inlineRequires?: boolean;
}

/**
 * Serializer configuration
 */
export interface SerializerConfig {
  /** Polyfill files to include */
  polyfills?: string[];
  /** Prelude files to include */
  prelude?: string[];
  /** Bundle type */
  bundleType?: BundleType;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  /** Port number */
  port?: number;
  /** Enable global hotkey */
  useGlobalHotkey?: boolean;
  /** Forward client logs */
  forwardClientLogs?: boolean;
  /** Verify connections */
  verifyConnections?: boolean;
  /** Unstable server root */
  unstable_serverRoot?: string | null;
}

/**
 * Main Bungae configuration
 */
export interface BungaeConfig {
  /** Project root directory */
  root?: string;
  /** Entry file path */
  entry?: string;
  /** Target platform */
  platform?: Platform;
  /** Development mode */
  dev?: boolean;
  /** Enable minification */
  minify?: boolean;
  /** Output directory */
  outDir?: string;
  /** Mode (development/production) */
  mode?: Mode;
  /** Resolver configuration */
  resolver?: ResolverConfig;
  /** Transformer configuration */
  transformer?: TransformerConfig;
  /** Serializer configuration */
  serializer?: SerializerConfig;
  /** Server configuration */
  server?: ServerConfig;
}

/**
 * Resolved configuration (with defaults applied)
 */
export interface ResolvedConfig extends Required<
  Omit<BungaeConfig, 'resolver' | 'transformer' | 'serializer' | 'server'>
> {
  resolver: Required<ResolverConfig>;
  transformer: Required<TransformerConfig>;
  serializer: Required<SerializerConfig>;
  server: Required<ServerConfig>;
}

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
  minifier?: 'bun' | 'terser' | 'esbuild' | 'swc';
  /** Enable inline requires */
  inlineRequires?: boolean;
}

/**
 * Experimental configuration
 * Features in this section are experimental and may change or be removed
 */
export interface ExperimentalConfig {
  /**
   * Enable tree shaking (remove unused exports and modules)
   *
   * ⚠️ EXPERIMENTAL: This feature is experimental and may have compatibility issues.
   *
   * ⚠️ WARNING: Metro includes ALL exports, allowing dynamic access at runtime.
   * Tree shaking removes unused exports, which can break code that:
   * - Dynamically accesses exports: `require('module')[key]`, `module.exports[key]`
   * - Uses CommonJS with dynamic property access
   * - Has side effects at module load time
   *
   * CommonJS modules (`require()`) are safer as they're treated as namespace imports
   * (all exports preserved). ESM named imports may have exports removed.
   *
   * Only enable if you're certain your code doesn't use dynamic access patterns.
   */
  treeShaking?: boolean;
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
  /** Extra global variables to inject into prelude (Metro-compatible) */
  extraVars?: Record<string, unknown>;
  /** Get modules to run before main module (Metro-compatible) */
  getModulesRunBeforeMainModule?: (
    entryFilePath: string,
    options?: { projectRoot: string; nodeModulesPaths: string[] },
  ) => string[];
  /** Get polyfills (Metro-compatible) */
  getPolyfills?: (options: { platform: string | null }) => string[];
  /** Inline source map in bundle (base64 encoded) */
  inlineSourceMap?: boolean;
  /** Should add module to ignore list (for x_google_ignoreList) */
  shouldAddToIgnoreList?: (module: {
    path: string;
    code: string;
    dependencies: string[];
    type?: string;
  }) => boolean;
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
  /** Experimental configuration */
  experimental?: ExperimentalConfig;
}

/**
 * Resolved configuration (with defaults applied)
 */
export interface ResolvedConfig extends Required<
  Omit<BungaeConfig, 'resolver' | 'transformer' | 'serializer' | 'server' | 'experimental'>
> {
  resolver: Required<ResolverConfig>;
  transformer: Required<TransformerConfig>;
  serializer: Required<Omit<SerializerConfig, 'shouldAddToIgnoreList'>> &
    Pick<SerializerConfig, 'shouldAddToIgnoreList'>;
  server: Required<ServerConfig>;
  experimental: Required<ExperimentalConfig>;
}

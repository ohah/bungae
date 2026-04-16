/**
 * Bungae Configuration Types
 */

import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Connect-style middleware (Metro 호환).
 * Express app도 이 시그니처를 따르므로 enhanceMiddleware의 반환 타입으로 사용 가능.
 */
export type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

export type Platform = 'ios' | 'android' | 'web';
export type Mode = 'development' | 'production';
export type BundleType = 'plain' | 'ram-indexed' | 'ram-file';
export type BundlerType = 'graph' | 'zts';

/**
 * Metro-compatible resolution result returned from `resolveRequest`.
 * - `type: 'sourceFile'`: 일반 파일/모듈 해석 결과 (절대 경로)
 * - `type: 'assetFiles'`: 에셋 파일 해석 결과 (배열, scale variant 묶음)
 * - `type: 'empty'`: 빈 모듈로 매핑 (webpack `false` 의미)
 */
export type ResolutionResult =
  | { type: 'sourceFile'; filePath: string }
  | { type: 'assetFiles'; filePaths: readonly string[] }
  | { type: 'empty' };

/**
 * Minimal resolution context passed to `resolveRequest`.
 * Metro의 ResolutionContext를 단순화한 형태 — 가장 흔한 케이스(originModulePath,
 * platform, default resolver fallback) 위주로 제공.
 *
 * `resolveRequest` 안에서 `context.resolveRequest(context, name, platform)`을
 * 호출하면 기본 해석기로 위임된다 (Metro 동작과 동일).
 */
export interface CustomResolutionContext {
  /** 요청한 모듈의 absolute path */
  originModulePath: string;
  /** 현재 빌드 플랫폼 */
  platform: string | null;
  /** 기본 해석기 (위임용). 무한 재귀 방지를 위해 호출 시 자기 자신은 제외됨 */
  resolveRequest: CustomResolver;
}

export type CustomResolver = (
  context: CustomResolutionContext,
  moduleName: string,
  platform: string | null,
) => ResolutionResult;

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
  /**
   * Fallback module map (Metro 호환).
   * 일반 해석이 실패했을 때만 적용 — 설치된 실제 패키지가 우선.
   * Node 빌트인 폴리필 (`crypto: require.resolve('crypto-browserify')`) 같은 유스케이스용.
   *
   * @example
   * extraNodeModules: {
   *   crypto: require.resolve('crypto-browserify'),
   *   stream: require.resolve('stream-browserify'),
   * }
   */
  extraNodeModules?: Record<string, string>;
  /**
   * Custom request resolver (Metro 호환).
   * 모든 import에 대해 호출되며 커스텀 해석 로직 반환. 기본 해석기로 위임하려면
   * `context.resolveRequest(context, moduleName, platform)`을 호출.
   *
   * 주의: 모든 import마다 호출되므로 성능 민감. 가능하면 `extraNodeModules`나
   * `blockList`로 해결 가능한지 먼저 검토.
   */
  resolveRequest?: CustomResolver;
}

/**
 * Transformer configuration
 */
export interface TransformerConfig {
  /** Minifier to use */
  minifier?: 'bun' | 'terser' | 'esbuild' | 'swc';
  /** Enable inline requires */
  inlineRequires?: boolean;
  /**
   * Path to a custom file transformer (Metro-compatible).
   * The module must export a `transform({ src, filename, options })` function.
   * Transformers chain by internally delegating to the default transformer for
   * file types they don't handle (decorator pattern — same as Metro).
   *
   * @example
   * babelTransformerPath: 'react-native-svg-transformer/react-native'
   */
  babelTransformerPath?: string;
  /**
   * Babel configuration for OXC bundler.
   * Runs user-configured Babel presets/plugins as a Rolldown transform hook.
   *
   * @example
   * babel: {
   *   presets: ['@ohah/react-native-mcp-server/babel-preset'],
   *   plugins: [
   *     'react-native-reanimated/plugin',
   *     ['@babel/plugin-proposal-decorators', { legacy: true }],
   *   ],
   * }
   */
  babel?: {
    presets?: (string | [string, Record<string, unknown>])[];
    plugins?: (string | [string, Record<string, unknown>])[];
  };
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
 * Stack frame passed to symbolicator.customizeFrame (Metro 호환).
 */
export interface SymbolicatorFrame {
  file?: string | null;
  lineNumber?: number | null;
  column?: number | null;
  methodName?: string | null;
}

/**
 * Symbolicator configuration (Metro 호환).
 * Hooks for customizing stack frames sent back to the React Native LogBox.
 */
export interface SymbolicatorConfig {
  /**
   * Per-frame customization. Return `{ collapse: true }` to mark a frame as
   * collapsible in DevTools (hidden by default, expandable on click).
   * Used to hide framework / polyfill frames.
   */
  customizeFrame?: (
    frame: SymbolicatorFrame,
  ) =>
    | { collapse?: boolean }
    | null
    | undefined
    | Promise<{ collapse?: boolean } | null | undefined>;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  /** Port number */
  port?: number;
  /** Host to bind server to */
  host?: string;
  /** Enable HTTPS */
  https?: boolean;
  /** Path to SSL key file */
  key?: string;
  /** Path to SSL cert file */
  cert?: string;
  /** Enable global hotkey */
  useGlobalHotkey?: boolean;
  /** Forward client logs */
  forwardClientLogs?: boolean;
  /** Verify connections */
  verifyConnections?: boolean;
  /** Unstable server root */
  unstable_serverRoot?: string | null;
  /**
   * Wrap the default dev server middleware (Metro 호환).
   * Receives the default middleware and an opaque server reference, returns a
   * new middleware (or Express app, which is connect-compatible).
   *
   * Used by tools like `@rozenite/metro` (`withRozenite`) to inject DevTools
   * panels via custom routes — the wrapper handles its own paths and delegates
   * the rest by calling `next()`.
   *
   * The second argument mirrors Metro's `MetroServer` slot. Bungae does not
   * expose a Metro-shaped server object, so plugins should treat it as opaque.
   */
  enhanceMiddleware?: (middleware: ConnectMiddleware, server: unknown) => ConnectMiddleware;
  /**
   * Rewrite incoming request URLs before routing (Metro 호환).
   * Called once per request at the start of handling, after jsc-safe URL
   * normalization. Use to redirect legacy bundle paths, inject query params,
   * or normalize platform-specific suffixes.
   *
   * @example
   * rewriteRequestUrl: (url) => url.replace('/old.bundle', '/index.bundle')
   */
  rewriteRequestUrl?: (url: string) => string;
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
  /**
   * Bundler type to use
   * - 'graph': Babel-based bundler (Metro-compatible, stable)
   * - 'zts': Zig-based transpiler/bundler (fast, subprocess)
   * @default 'graph'
   */
  bundler?: BundlerType;

  // --- Build output options (Metro/RN CLI compatible) ---

  /** Output bundle file path (Metro: --out, RN CLI: --bundle-output) */
  bundleOutput?: string;
  /** Source map output file path (RN CLI: --sourcemap-output) */
  sourcemapOutput?: string;
  /** Root path for source map sources (RN CLI: --sourcemap-sources-root) */
  sourcemapSourcesRoot?: string;
  /** Use absolute paths in source maps (RN CLI: --sourcemap-use-absolute-path) */
  sourcemapUseAbsolutePath?: boolean;
  /** Generate source map (Metro: --source-map) */
  sourceMap?: boolean;
  /** Source map URL override (Metro: --source-map-url) */
  sourceMapUrl?: string;
  /** Assets output directory (RN CLI: --assets-dest) */
  assetsDest?: string;
  /** iOS asset catalog destination (RN CLI: --asset-catalog-dest) */
  assetCatalogDest?: string;
  /** Bundle encoding (RN CLI: --bundle-encoding) */
  bundleEncoding?: BufferEncoding;
  /** Clear bundler cache before building */
  resetCache?: boolean;
  /** Maximum number of worker threads */
  maxWorkers?: number;
  /** Additional watch folders (RN CLI: --watchFolders) */
  watchFolders?: string[];
  /** Additional source extensions (RN CLI: --sourceExts) */
  sourceExts?: string[];
  /** Custom transform options (Metro: --transform-option key=value) */
  transformOptions?: Record<string, string>;
  /** Custom resolver options (Metro: --resolver-option key=value) */
  resolverOptions?: Record<string, string>;
  /** JS engine transform profile (RN CLI: --unstable-transform-profile) */
  unstableTransformProfile?: 'default' | 'hermes-stable' | 'hermes-canary';
  /** Disable interactive terminal mode */
  interactive?: boolean;

  /** Resolver configuration */
  resolver?: ResolverConfig;
  /** Transformer configuration */
  transformer?: TransformerConfig;
  /** Serializer configuration */
  serializer?: SerializerConfig;
  /** Server configuration */
  server?: ServerConfig;
  /** Symbolicator configuration (Metro 호환) */
  symbolicator?: SymbolicatorConfig;
  /** Experimental configuration */
  experimental?: ExperimentalConfig;
}

/**
 * Resolved configuration (with defaults applied)
 */
export interface ResolvedConfig extends Required<
  Omit<BungaeConfig, 'resolver' | 'transformer' | 'serializer' | 'server' | 'experimental'>
> {
  resolver: Required<Omit<ResolverConfig, 'resolveRequest'>> &
    Pick<ResolverConfig, 'resolveRequest'>;
  transformer: Required<TransformerConfig>;
  serializer: Required<Omit<SerializerConfig, 'shouldAddToIgnoreList'>> &
    Pick<SerializerConfig, 'shouldAddToIgnoreList'>;
  server: Required<ServerConfig>;
  symbolicator: Required<SymbolicatorConfig>;
  experimental: Required<ExperimentalConfig>;
}

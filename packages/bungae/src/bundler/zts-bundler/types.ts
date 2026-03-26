/**
 * Type definitions for ZTS Bundler (Zig NAPI-based)
 */

export interface ZtsBuildResult {
  /** Generated bundle code */
  code: string;
  /** Source map (JSON string) */
  map?: string;
  /** Hermes bytecode output path (if compiled) */
  hermesBytecode?: string;
  /** Detected assets */
  assets: AssetData[];
}

export interface ZtsBuildOptions {
  /** Output file path */
  outfile?: string;
  /** Enable minification */
  minify?: boolean;
  /** Source map generation: true, 'inline', 'hidden', false */
  sourcemap?: boolean | 'inline' | 'hidden';
  /** Compile to Hermes bytecode after bundling */
  hermes?: boolean;
}

export interface AssetData {
  __packager_asset: boolean;
  fileSystemLocation: string;
  httpServerLocation: string;
  hash: string;
  name: string;
  scales: number[];
  type: string;
  width?: number;
  height?: number;
}

/**
 * ZTS NAPI binding interface.
 * This represents the native addon API exposed by the ZTS Zig binary.
 *
 * TODO: Implement in ZTS (Zig NAPI addon)
 */
export interface ZtsNativeBinding {
  /** Bundle entry point with options, returns bundle code + sourcemap */
  bundle(options: ZtsNativeBundleOptions): ZtsNativeBundleResult;

  /** Incremental update: re-process changed files, return patch */
  incrementalUpdate(changedFiles: string[]): ZtsNativePatchResult;

  /** Release resources (module graph, caches) */
  destroy(): void;
}

export interface ZtsNativeBundleOptions {
  /** Entry file absolute path */
  entry: string;
  /** Project root */
  root: string;
  /** Target platform */
  platform: 'ios' | 'android' | 'web';
  /** Development mode */
  dev: boolean;
  /** File extensions to resolve (platform-specific order) */
  extensions: string[];
  /** Package.json main fields priority */
  mainFields: string[];
  /** Export condition names */
  conditionNames: string[];
  /** Enable tree shaking */
  treeshake: boolean;
  /** Enable minification */
  minify: boolean;
  /** Generate source map */
  sourcemap: boolean;
  /** Prelude code (var __DEV__ = true; etc.) */
  preludeCode?: string;
  /** Polyfill module paths to prepend */
  polyfillPaths?: string[];
  /**
   * Babel transform callback.
   * Called when ZTS encounters a file that needs Babel processing.
   * Returns transformed code, or null to skip Babel.
   */
  babelTransform?: (filePath: string, code: string) => string | null;
}

export interface ZtsNativeBundleResult {
  /** Generated bundle code */
  code: string;
  /** Source map (JSON string) */
  map?: string;
}

export interface ZtsNativePatchResult {
  /** HMR patch code for changed modules */
  patch: string;
  /** List of updated module paths */
  updatedModules: string[];
}

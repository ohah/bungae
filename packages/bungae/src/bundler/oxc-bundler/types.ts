/**
 * Type definitions for OXC Bundler (Rolldown-based)
 */

export interface OxcBuildResult {
  /** Generated bundle code */
  code: string;
  /** Source map (JSON string) */
  map?: string;
  /** Hermes bytecode output path (if compiled) */
  hermesBytecode?: string;
  /** Detected assets */
  assets: AssetData[];
}

export interface OxcBuildOptions {
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

export interface HermesCompileResult {
  /** Output .hbc file path */
  outputPath: string;
  /** Source map path (if generated) */
  sourceMapPath?: string;
  /** Compilation time in ms */
  duration: number;
  /** Output file size in bytes */
  size: number;
}

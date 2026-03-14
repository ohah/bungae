/**
 * Type definitions for OXC Bundler (Rolldown-based)
 */

export interface ChunkInfo {
  /** Chunk name (e.g., 'settings-abc123') */
  name: string;
  /** Chunk file name (e.g., 'settings-abc123.js') */
  fileName: string;
  /** Generated chunk code */
  code: string;
  /** Source map (JSON string) */
  map?: string;
  /** Whether this chunk was created from a dynamic import() */
  isDynamicEntry: boolean;
}

export interface OxcBuildResult {
  /** Generated bundle code (entry chunk) */
  code: string;
  /** Source map (JSON string) */
  map?: string;
  /** Hermes bytecode output path (if compiled) */
  hermesBytecode?: string;
  /** Detected assets */
  assets: AssetData[];
  /** Non-entry chunks (only when code splitting is enabled) */
  chunks?: ChunkInfo[];
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

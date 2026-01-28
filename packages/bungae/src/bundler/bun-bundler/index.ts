/**
 * Bun Bundler - Uses Bun.Transpiler for fast transformation + Metro __d()/__r() for module system
 *
 * This is a copy of graph-bundler with transformer replaced by Bun.Transpiler.
 *
 * This approach:
 * 1. Build dependency graph from entry point
 * 2. Transform each module using Bun.Transpiler (faster than Babel)
 * 3. Wrap each module with __d() for Metro-compatible module system
 * 4. Serialize using Metro's module execution order
 *
 * Benefits:
 * - Much faster transformation (Bun.Transpiler is 10-100x faster than Babel)
 * - Correct module execution order via __d()/__r()
 * - Metro-compatible output
 *
 * Limitations:
 * - Flow syntax falls back to Babel (hermes-parser + Babel)
 */

// Public exports (renamed from graph-bundler)
export { buildWithGraph as buildWithBunTranspiler } from './build';
export type { BuildOptions } from './build';
export { serveWithGraph as serveWithBunTranspiler } from './server';
export { createHMRUpdateMessage, incrementalBuild } from './hmr';

// Type exports
export type {
  AssetInfo,
  BuildResult,
  DeltaResult,
  GraphModule,
  HMRUpdateMessage,
  PlatformBuildState,
} from './types';

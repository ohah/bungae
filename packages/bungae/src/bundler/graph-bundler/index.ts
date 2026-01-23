/**
 * Graph Bundler - Uses Bun.build() for transformation + Metro __d()/__r() for module system
 *
 * This approach:
 * 1. Build dependency graph from entry point
 * 2. Transform each module using Babel (Metro-compatible)
 * 3. Wrap each module with __d() for Metro-compatible module system
 * 4. Serialize using Metro's module execution order
 *
 * Benefits:
 * - Fast transformation
 * - Correct module execution order via __d()/__r()
 * - Metro-compatible output
 */

// Public exports
export { buildWithGraph } from './build';
export { serveWithGraph } from './server';
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

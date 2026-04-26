/**
 * Bundler module - Exports bundling functions
 *
 * zts-bundler: Zig/NAPI-based React Native bundler (default)
 * graph-bundler: legacy Babel-based bundler
 *
 * Select bundler via config.bundler: 'graph' | 'zts'
 */

import type { ResolvedConfig } from '../config/types';

// Re-export types from graph-bundler
export type { BuildResult, GraphModule, BuildOptions } from './graph-bundler';

// Graph bundler with Metro __d()/__r() module system (legacy fallback)
export { buildWithGraph, serveWithGraph } from './graph-bundler';

// ZTS bundler (Zig-based, NAPI in-process)
export { buildWithZts, serveWithZts } from './zts-bundler';

/**
 * Build bundle using configured bundler
 */
export async function build(
  config: ResolvedConfig,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
  options?: import('./graph-bundler').BuildOptions,
): Promise<import('./graph-bundler').BuildResult> {
  if (config.bundler === 'zts') {
    const { buildWithZts } = await import('./zts-bundler');
    return buildWithZts(config, onProgress);
  }

  const { buildWithGraph } = await import('./graph-bundler');
  return buildWithGraph(config, onProgress, options);
}

/**
 * Start dev server using configured bundler
 */
export async function serve(config: ResolvedConfig): Promise<{ stop: () => Promise<void> }> {
  if (config.bundler === 'zts') {
    const { serveWithZts } = await import('./zts-bundler');
    return serveWithZts(config);
  }

  const { serveWithGraph } = await import('./graph-bundler');
  return serveWithGraph(config);
}

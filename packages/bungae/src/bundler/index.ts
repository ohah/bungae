/**
 * Bundler module - Exports bundling functions
 *
 * graph-bundler: Babel-based, Metro-compatible, stable
 *
 * Select bundler via config.bundler: 'graph'
 */

import type { ResolvedConfig } from '../config/types';

// Re-export types from graph-bundler
export type { BuildResult, GraphModule, BuildOptions } from './graph-bundler';

// Graph bundler with Metro __d()/__r() module system (default, stable)
export { buildWithGraph, serveWithGraph } from './graph-bundler';

/**
 * Build bundle using graph-bundler
 */
export async function build(
  config: ResolvedConfig,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
  options?: import('./graph-bundler').BuildOptions,
): Promise<import('./graph-bundler').BuildResult> {
  console.log('📦 Using graph-bundler (Babel, stable)');
  const { buildWithGraph } = await import('./graph-bundler');
  return buildWithGraph(config, onProgress, options);
}

/**
 * Start dev server using graph-bundler
 */
export async function serve(config: ResolvedConfig): Promise<{ stop: () => Promise<void> }> {
  console.log('📦 Using graph-bundler (Babel, stable)');
  const { serveWithGraph } = await import('./graph-bundler');
  return serveWithGraph(config);
}

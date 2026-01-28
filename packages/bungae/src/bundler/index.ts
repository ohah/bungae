/**
 * Bundler module - Exports bundling functions
 *
 * Two bundler implementations:
 * - graph-bundler: Babel-based, Metro-compatible, stable (default)
 * - bun-bundler: Bun.Transpiler-based, faster, experimental
 *
 * Select bundler via config.bundler: 'graph' | 'bun'
 */

import type { ResolvedConfig } from '../config/types';

// Re-export types from graph-bundler (shared between both bundlers)
export type { BuildResult, GraphModule, BuildOptions } from './graph-bundler';

// Graph bundler with Metro __d()/__r() module system (default, stable)
export { buildWithGraph, serveWithGraph } from './graph-bundler';

// Bun bundler with Bun.Transpiler (faster, experimental)
export { buildWithBunTranspiler, serveWithBunTranspiler } from './bun-bundler';

// Track if bundler selection has been logged (prevent duplicate logs)
let bundlerSelectionLogged = false;

/**
 * Log bundler selection to terminal (only once per process)
 */
function logBundlerSelection(bundlerType: 'graph' | 'bun'): void {
  if (bundlerSelectionLogged) return;
  bundlerSelectionLogged = true;

  if (bundlerType === 'bun') {
    console.log('📦 Using bun-bundler (Bun.Transpiler, experimental)');
  } else {
    console.log('📦 Using graph-bundler (Babel, stable)');
  }
}

/**
 * Build bundle using the bundler specified in config
 * Automatically selects graph-bundler or bun-bundler based on config.bundler
 */
export async function build(
  config: ResolvedConfig,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
  options?: import('./graph-bundler').BuildOptions,
): Promise<import('./graph-bundler').BuildResult> {
  const bundlerType = config.bundler || 'graph';
  logBundlerSelection(bundlerType);

  if (bundlerType === 'bun') {
    const { buildWithBunTranspiler } = await import('./bun-bundler');
    return buildWithBunTranspiler(config, onProgress, options);
  }

  // Default: graph bundler (Babel-based)
  const { buildWithGraph } = await import('./graph-bundler');
  return buildWithGraph(config, onProgress, options);
}

/**
 * Start dev server using the bundler specified in config
 * Automatically selects graph-bundler or bun-bundler based on config.bundler
 */
export async function serve(config: ResolvedConfig): Promise<{ stop: () => Promise<void> }> {
  const bundlerType = config.bundler || 'graph';
  logBundlerSelection(bundlerType);

  if (bundlerType === 'bun') {
    const { serveWithBunTranspiler } = await import('./bun-bundler');
    return serveWithBunTranspiler(config);
  }

  // Default: graph bundler (Babel-based)
  const { serveWithGraph } = await import('./graph-bundler');
  return serveWithGraph(config);
}

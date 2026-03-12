/**
 * Bundler module - Exports bundling functions
 *
 * Three bundler implementations:
 * - oxc-bundler: Rolldown-based, ESM with strictExecutionOrder, v2 (default)
 * - graph-bundler: Babel-based, Metro-compatible, stable
 * - bun-bundler: Bun.Transpiler-based, faster, experimental
 *
 * Select bundler via config.bundler: 'graph' | 'bun' | 'oxc'
 */

import type { ResolvedConfig } from '../config/types';

// Re-export types from graph-bundler (shared between both bundlers)
export type { BuildResult, GraphModule, BuildOptions } from './graph-bundler';

// Graph bundler with Metro __d()/__r() module system (default, stable)
export { buildWithGraph, serveWithGraph } from './graph-bundler';

// Bun bundler with Bun.Transpiler (faster, experimental)
export { buildWithBunTranspiler, serveWithBunTranspiler } from './bun-bundler';

// OXC bundler with Rolldown (ESM, strictExecutionOrder, v2)
export { buildWithOxc, serveWithOxc } from './oxc-bundler';
export type { OxcBuildResult, OxcBuildOptions } from './oxc-bundler';

// Track if bundler selection has been logged (prevent duplicate logs)
let bundlerSelectionLogged = false;

/**
 * Log bundler selection to terminal (only once per process)
 */
function logBundlerSelection(bundlerType: 'graph' | 'bun' | 'oxc'): void {
  if (bundlerSelectionLogged) return;
  bundlerSelectionLogged = true;

  if (bundlerType === 'oxc') {
    console.log('⚡ Using oxc-bundler (Rolldown, v2)');
  } else if (bundlerType === 'bun') {
    console.log('📦 Using bun-bundler (Bun.Transpiler, experimental)');
  } else {
    console.log('📦 Using graph-bundler (Babel, stable)');
  }
}

/**
 * Build bundle using the bundler specified in config
 * Automatically selects graph-bundler, bun-bundler, or oxc-bundler based on config.bundler
 */
export async function build(
  config: ResolvedConfig,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
  options?: import('./graph-bundler').BuildOptions,
): Promise<import('./graph-bundler').BuildResult> {
  const bundlerType = config.bundler || 'oxc';
  logBundlerSelection(bundlerType);

  if (bundlerType === 'graph') {
    const { buildWithGraph } = await import('./graph-bundler');
    return buildWithGraph(config, onProgress, options);
  }

  if (bundlerType === 'bun') {
    const { buildWithBunTranspiler } = await import('./bun-bundler');
    return buildWithBunTranspiler(config, onProgress, options);
  }

  // Default: oxc bundler (Rolldown, v2)
  const { buildWithOxc } = await import('./oxc-bundler');
  const result = await buildWithOxc(config, onProgress);
  // Adapt OxcBuildResult to BuildResult interface
  return {
    code: result.code,
    map: result.map,
    assets: [],
  };
}

/**
 * Start dev server using the bundler specified in config
 * Automatically selects graph-bundler, bun-bundler, or oxc-bundler based on config.bundler
 */
export async function serve(config: ResolvedConfig): Promise<{ stop: () => Promise<void> }> {
  const bundlerType = config.bundler || 'oxc';
  logBundlerSelection(bundlerType);

  if (bundlerType === 'graph') {
    const { serveWithGraph } = await import('./graph-bundler');
    return serveWithGraph(config);
  }

  if (bundlerType === 'bun') {
    const { serveWithBunTranspiler } = await import('./bun-bundler');
    return serveWithBunTranspiler(config);
  }

  // Default: oxc bundler dev server (Rolldown DevEngine)
  const { serveWithOxc } = await import('./oxc-bundler');
  return serveWithOxc(config);
}

/**
 * Bun Bundler - Bundle entire module graph using Bun.build()
 *
 * NOTE: Currently NOT USED. Using graph-bundler.ts with Babel + Hermes Parser instead.
 * This bundler uses Bun.build() which doesn't support Metro's __d()/__r() module system,
 * causing module execution order issues with React Native.
 *
 * Kept for future optimization when:
 * 1. Metro module system is no longer required
 * 2. Bun.build() adds better React Native support
 *
 * See: graph-bundler.ts for the actual bundling logic.
 */

// import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
// import { dirname, join, resolve } from 'path';
// import type { ResolvedConfig } from '../config/types';
// import { hasFlowSyntax, transformForHermes } from '../transformer/swc-transformer';

/*
 * All code below is commented out because we're using graph-bundler.ts instead.
 * The graph bundler uses Metro's __d()/__r() module system for correct module execution order.
 *
 * function getGlobalVariables(dev: boolean, platform: string): string { ... }
 * function getPolyfillPaths(projectRoot: string): string[] { ... }
 * function createBungaePlugin(config: ResolvedConfig): import('bun').BunPlugin { ... }
 * export interface BuildResult { code: string; map?: string; }
 * export async function buildWithBun(config: ResolvedConfig): Promise<BuildResult> { ... }
 * export async function serveWithBun(config: ResolvedConfig): Promise<void> { ... }
 */

export interface BuildResult {
  code: string;
  map?: string;
}

// Stub exports to maintain API compatibility (not actually used)
export async function buildWithBun(): Promise<BuildResult> {
  throw new Error('buildWithBun is not used. Use buildWithGraph from graph-bundler.ts instead.');
}

export async function serveWithBun(): Promise<void> {
  throw new Error('serveWithBun is not used. Use serveWithGraph from graph-bundler.ts instead.');
}

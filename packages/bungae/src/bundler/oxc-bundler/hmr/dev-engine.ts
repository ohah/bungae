/**
 * Dev Build Engine for OXC Bundler
 *
 * Uses Phase 1's buildWithOxc() for bundling + file watcher for change detection.
 * On file change: full rebuild → cache → notify HMR clients (full reload).
 *
 * Why not Rolldown's experimental DevEngine (dev() API):
 * - devMode.implement requires pre-compiled JS file path (TS not supported)
 * - #private class fields issue is solved by hermes-compat plugin (SWC renderChunk)
 * - However, dev() API's renderChunk hook support is unconfirmed
 * - Once confirmed, can switch to dev() API for true patch HMR
 *
 * Trade-off: Full reload instead of patch HMR (no component state preservation).
 * In practice, Rolldown rebuild takes ~1s which is acceptable for dev.
 *
 * Future: If dev() API supports renderChunk, switch to it for patch HMR
 * with React Refresh and component state preservation.
 */

import EventEmitter from 'node:events';
import { watch, type FSWatcher } from 'node:fs';

import type { ResolvedConfig } from '../../../config/types';
import { buildWithOxc } from '../bundler';

export interface DevEngineEventMap {
  buildStart: [];
  buildDone: [{ code: string; map?: string }];
  buildFailed: [Error];
  watchChange: [string];
}

export interface DevEngineOptions {
  host: string;
  port: number;
}

interface CachedBundle {
  code: string;
  map?: string;
}

export class OxcDevEngine extends EventEmitter<DevEngineEventMap> {
  private cachedBundle: CachedBundle | null = null;
  private buildError: Error | null = null;
  private state: 'idle' | 'building' | 'ready' = 'idle';
  private initPromise: Promise<void> | null = null;
  private watcher: FSWatcher | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly _options: DevEngineOptions,
  ) {
    super();
  }

  /**
   * Initial build + start file watching
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;

    this.initPromise = this.build();
    await this.initPromise;

    this.startWatching();
  }

  /**
   * Run a full build with buildWithOxc()
   */
  private async build(): Promise<void> {
    this.state = 'building';
    this.emit('buildStart');

    try {
      const result = await buildWithOxc(this.config, undefined, {
        sourcemap: true,
        minify: false,
        hermes: false, // Dev mode: no Hermes compilation
      });

      this.cachedBundle = {
        code: result.code,
        map: result.map,
      };
      this.buildError = null;
      this.state = 'ready';
      this.emit('buildDone', this.cachedBundle);
    } catch (error: any) {
      this.buildError = error;
      this.state = 'ready'; // Still "ready" - can serve error to clients
      this.emit('buildFailed', error);
    }
  }

  /**
   * Start watching source files for changes
   */
  private startWatching(): void {
    // Watch project root recursively
    try {
      this.watcher = watch(this.config.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;

        // Filter: only source files
        if (!this.isSourceFile(filename)) return;

        // Ignore common non-source dirs
        if (this.shouldIgnore(filename)) return;

        this.emit('watchChange', filename);
        this.scheduleRebuild();
      });
    } catch (error) {
      console.warn('[OXC] File watcher failed to start:', error);
    }
  }

  /**
   * Debounced rebuild (300ms)
   */
  private scheduleRebuild(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }

    this.rebuildTimer = setTimeout(async () => {
      this.rebuildTimer = null;
      console.log('[OXC] File changed, rebuilding...');
      await this.build();
    }, 300);
  }

  /**
   * Get the current bundle
   */
  async getBundle(): Promise<CachedBundle> {
    // Wait for initial build
    if (this.initPromise) {
      await this.initPromise;
    }

    if (this.buildError) {
      throw this.buildError;
    }

    if (!this.cachedBundle) {
      throw new Error('No bundle available');
    }

    return this.cachedBundle;
  }

  /**
   * Register modules for a client (no-op in rebuild mode)
   */
  async registerModules(_clientId: string, _modules: string[]): Promise<void> {
    // No-op: full rebuild mode doesn't track per-client modules
  }

  /**
   * Remove a client (no-op in rebuild mode)
   */
  async removeClient(_clientId: string): Promise<void> {
    // No-op
  }

  /**
   * Shut down
   */
  async close(): Promise<void> {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.state = 'idle';
    this.removeAllListeners();
  }

  private isSourceFile(filename: string): boolean {
    return /\.(js|jsx|ts|tsx|json|mjs|cjs)$/.test(filename);
  }

  private shouldIgnore(filename: string): boolean {
    return (
      filename.includes('node_modules') ||
      filename.includes('.git') ||
      filename.includes('.bungae-cache') ||
      filename.includes('dist/') ||
      filename.includes('build/')
    );
  }
}

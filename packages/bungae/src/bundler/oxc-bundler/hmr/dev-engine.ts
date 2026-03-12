/**
 * DevEngine Wrapper for Rolldown
 *
 * Wraps Rolldown's experimental DevEngine API to provide:
 * - Incremental builds with file watching
 * - HMR update generation and lifecycle management
 * - Bundle caching (in-memory)
 * - Event-based architecture for server integration
 */

import EventEmitter from 'node:events';
import { resolve } from 'node:path';

import type { InputOptions, OutputOptions } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';
import {
  platformResolverPlugin,
  buildExtensions,
  flowStripPlugin,
  assetPlugin,
  preludePlugin,
  jsonPlugin,
} from '../plugins';

export interface DevEngineEventMap {
  buildStart: [];
  buildDone: [{ code: string; map?: string }];
  buildFailed: [Error];
  hmrUpdates: [HmrUpdate[]];
  watchChange: [string];
}

export interface HmrUpdate {
  clientId: string;
  update:
    | { type: 'Patch'; code: string; filename: string; sourcemap?: string }
    | { type: 'FullReload'; reason?: string }
    | { type: 'Noop' };
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
  private devEngine: any = null;
  private cachedBundle: CachedBundle | null = null;
  private buildError: Error | null = null;
  private state: 'idle' | 'initializing' | 'ready' = 'idle';
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly options: DevEngineOptions,
  ) {
    super();
  }

  /**
   * Initialize and start the DevEngine
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.state = 'initializing';

    this.initPromise = this.initialize();
    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    // Dynamic import for rolldown/experimental (NAPI, Node.js only)
    const { dev } = await import('rolldown/experimental');

    const entryPath = resolve(this.config.root, this.config.entry);
    const extensions = buildExtensions(this.config.platform, this.config.resolver.sourceExts);

    // Resolve prelude modules
    const preludeModules = this.resolvePreludeModules();

    const inputOptions: InputOptions = {
      input: entryPath,
      platform: 'neutral',
      cwd: this.config.root,

      resolve: {
        extensions,
        mainFields: ['react-native', 'browser', 'main', 'module'],
        conditionNames: ['react-native', 'import', 'require', 'default'],
      },

      treeshake: false, // Always off in dev mode

      plugins: [
        preludePlugin(this.config, { preludeModules }),
        flowStripPlugin(this.config),
        assetPlugin(this.config),
        jsonPlugin(),
        platformResolverPlugin(this.config),
      ],

      // Note: experimental.devMode requires a pre-compiled JS runtime file.
      // HMR is handled at the server level for now (full rebuild + WebSocket push).
      // TODO: Pre-compile runtime.ts → runtime.js for Rolldown devMode integration
    };

    const outputOptions: OutputOptions = {
      format: 'esm',
      strictExecutionOrder: true,
      sourcemap: true,
      minify: false,
    };

    const devEngine = await dev(inputOptions, outputOptions, {
      onHmrUpdates: (errorOrResult) => {
        if (errorOrResult instanceof Error) {
          this.buildError = errorOrResult;
          this.emit('buildFailed', errorOrResult);
        } else {
          this.emit('hmrUpdates', errorOrResult.updates as HmrUpdate[]);
          for (const file of errorOrResult.changedFiles) {
            this.emit('watchChange', file);
          }
        }
      },

      onOutput: (errorOrResult) => {
        if (errorOrResult instanceof Error) {
          this.buildError = errorOrResult;
          this.emit('buildFailed', errorOrResult);
        } else {
          const chunk = errorOrResult.output[0];
          if (chunk && chunk.type === 'chunk') {
            this.cachedBundle = {
              code: chunk.code,
              map: chunk.map?.toString(),
            };
            this.buildError = null;
            this.emit('buildDone', this.cachedBundle);
          }
        }
      },

      rebuildStrategy: 'auto',
    });

    await devEngine.run();
    this.devEngine = devEngine;
    this.state = 'ready';
  }

  /**
   * Wait for initialization to complete
   */
  async ensureReady(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.initPromise) await this.initPromise;
  }

  /**
   * Get the current bundle (waits for latest build if stale)
   */
  async getBundle(): Promise<CachedBundle> {
    await this.ensureReady();

    if (!this.devEngine) {
      throw new Error('DevEngine not initialized');
    }

    const state = await this.devEngine.getBundleState();

    if (state.lastFullBuildFailed) {
      throw this.buildError || new Error('Build failed');
    }

    if (state.hasStaleOutput || !this.cachedBundle) {
      await this.devEngine.ensureLatestBuildOutput();
    }

    if (!this.cachedBundle) {
      throw new Error('No bundle available');
    }

    return this.cachedBundle;
  }

  /**
   * Register modules for a connected client
   */
  async registerModules(clientId: string, modules: string[]): Promise<void> {
    await this.ensureReady();
    if (this.devEngine) {
      await this.devEngine.registerModules(clientId, modules);
    }
  }

  /**
   * Remove a disconnected client
   */
  async removeClient(clientId: string): Promise<void> {
    if (this.devEngine) {
      await this.devEngine.removeClient(clientId);
    }
  }

  /**
   * Shut down the DevEngine
   */
  async close(): Promise<void> {
    if (this.devEngine) {
      await this.devEngine.close();
      this.devEngine = null;
    }
    this.state = 'idle';
    this.removeAllListeners();
  }

  private resolvePreludeModules(): string[] {
    if (!this.config.serializer?.getModulesRunBeforeMainModule) return [];
    try {
      const entryPath = resolve(this.config.root, this.config.entry);
      return this.config.serializer.getModulesRunBeforeMainModule(entryPath, {
        projectRoot: this.config.root,
        nodeModulesPaths: this.config.resolver.nodeModulesPaths,
      });
    } catch {
      return [];
    }
  }
}

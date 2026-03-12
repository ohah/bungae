/**
 * Dev Build Engine for OXC Bundler
 *
 * Uses Rolldown's experimental DevEngine (dev() API) for:
 * - Patch HMR: only changed modules are sent as patches (component state preserved)
 * - Incremental builds: Rolldown handles internal incremental rebuild
 * - Built-in file watching: DevEngine's native watcher, no manual fs.watch()
 * - React Refresh: import.meta.hot boundaries for Fast Refresh
 *
 * Falls back to full rebuild when DevEngine emits FullReload updates.
 */

import EventEmitter from 'node:events';
import { readFileSync } from 'node:fs';

import type { RolldownOutput } from 'rolldown';
import { dev, transformSync, type DevEngine, type BindingClientHmrUpdate } from 'rolldown/experimental';

import type { ResolvedConfig } from '../../../config/types';
import { createRolldownOptions } from '../bundler';
import { hermesCompatPlugin, hmrClientReplacePlugin, reactRefreshPlugin } from '../plugins';
import { generatePreludeCode } from '../plugins/prelude';
import { patchRolldownRuntime, transformToES5 } from './hermes-compat-utils';
import type { HMRUpdateResult } from './types';

export interface DevEngineEventMap {
  buildStart: [];
  buildDone: [{ code: string; map?: string }];
  buildFailed: [Error];
  watchChange: [string];
  hmrUpdate: [HMRUpdateResult];
}

export interface DevEngineOptions {
  host: string;
  port: number;
}

interface CachedBundle {
  code: string;
  map?: string;
}

/**
 * Compile hmr/runtime.ts to JS for DevEngine's devMode.implement.
 * Cached after first compilation.
 */
let compiledRuntimeCode: string | null = null;

function compileRuntime(): string {
  if (compiledRuntimeCode != null) return compiledRuntimeCode;

  const runtimeSource = readFileSync(require.resolve('./runtime'), 'utf-8');
  const result = transformSync('runtime.ts', runtimeSource, {
    sourcemap: false,
  });
  compiledRuntimeCode = result.code;
  return compiledRuntimeCode;
}

export class OxcDevEngine extends EventEmitter<DevEngineEventMap> {
  private engine: DevEngine | null = null;
  private cachedBundle: CachedBundle | null = null;
  private buildError: Error | null = null;
  private state: 'idle' | 'building' | 'ready' = 'idle';
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly options: DevEngineOptions,
  ) {
    super();
  }

  /**
   * Start DevEngine: initial build + file watching
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;

    this.initPromise = this.startDevEngine();
    await this.initPromise;
  }

  private async startDevEngine(): Promise<void> {
    this.state = 'building';
    this.emit('buildStart');

    try {
      const runtimeCode = compileRuntime();
      const prelude = generatePreludeCode(true, this.config.platform);
      const polyfillCode = await loadRNPolyfills(this.config.root);

      const { inputOptions, outputOptions } = createRolldownOptions(this.config, {
        sourcemap: true,
        minify: false,
        dev: true,
        extraPlugins: [
          hmrClientReplacePlugin(),
          ...reactRefreshPlugin(),
        ],
      });

      // Add DevEngine-specific experimental options
      (inputOptions as any).experimental = {
        devMode: { implement: runtimeCode },
        incrementalBuild: true,
      };

      // Add IIFE wrapping to output
      const devOutputOptions = {
        ...outputOptions,
        intro: `var global = globalThis;\n${prelude}\n${polyfillCode}\n(function() {`,
        outro: '}).call(globalThis);',
      };

      this.engine = await dev(inputOptions, devOutputOptions, {
        onHmrUpdates: (result) => this.handleHmrUpdates(result),
        onOutput: (result) => this.handleOutput(result),
        rebuildStrategy: 'auto',
      });

      await this.engine.run();
    } catch (error: any) {
      this.buildError = error;
      this.state = 'ready';
      this.emit('buildFailed', error);
    }
  }

  /**
   * Handle HMR update events from DevEngine
   */
  private handleHmrUpdates(
    result: Error | { updates: BindingClientHmrUpdate[]; changedFiles: string[] },
  ): void {
    if (result instanceof Error) {
      this.buildError = result;
      this.emit('buildFailed', result);
      return;
    }

    for (const file of result.changedFiles) {
      this.emit('watchChange', file);
    }

    // Post-process patch code for Hermes compatibility
    const processedUpdates = result.updates.map((update) => {
      if (update.update.type === 'Patch') {
        let code = update.update.code;
        code = patchRolldownRuntime(code);
        return {
          ...update,
          update: { ...update.update, code },
        };
      }
      return update;
    });

    this.emit('hmrUpdate', {
      updates: processedUpdates,
      changedFiles: result.changedFiles,
    });
  }

  /**
   * Handle initial and rebuild output from DevEngine
   */
  private handleOutput(result: Error | RolldownOutput): void {
    if (result instanceof Error) {
      this.buildError = result;
      this.state = 'ready';
      this.emit('buildFailed', result);
      return;
    }

    const mainChunk = result.output.find((o) => o.type === 'chunk' && o.isEntry);
    if (!mainChunk || mainChunk.type !== 'chunk') {
      const error = new Error('No output chunk generated');
      this.buildError = error;
      this.state = 'ready';
      this.emit('buildFailed', error);
      return;
    }

    // Post-process for Hermes compatibility
    let code = mainChunk.code;
    code = patchRolldownRuntime(code);

    this.cachedBundle = {
      code,
      map: mainChunk.map?.toString(),
    };
    this.buildError = null;
    this.state = 'ready';
    this.emit('buildDone', this.cachedBundle);
  }

  /**
   * Get the current bundle
   */
  async getBundle(): Promise<CachedBundle> {
    if (this.initPromise) {
      await this.initPromise;
    }

    // Wait for DevEngine to produce output
    if (this.engine && !this.cachedBundle && !this.buildError) {
      await this.engine.ensureLatestBuildOutput();
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
   * Register modules for a client (used by DevEngine for HMR tracking)
   */
  async registerModules(clientId: string, modules: string[]): Promise<void> {
    if (this.engine) {
      await this.engine.registerModules(clientId, modules);
    }
  }

  /**
   * Remove a client from DevEngine tracking
   */
  async removeClient(clientId: string): Promise<void> {
    if (this.engine) {
      await this.engine.removeClient(clientId);
    }
  }

  /**
   * Invalidate a specific module
   */
  async invalidate(moduleId: string): Promise<BindingClientHmrUpdate[]> {
    if (this.engine) {
      return this.engine.invalidate(moduleId);
    }
    return [];
  }

  /**
   * Shut down
   */
  async close(): Promise<void> {
    if (this.engine) {
      await this.engine.close();
      this.engine = null;
    }
    this.state = 'idle';
    this.removeAllListeners();
  }
}

/**
 * Load React Native polyfills (console, error-guard) from rn-get-polyfills.
 * Cached after first load since polyfills don't change during a session.
 */
let cachedPolyfillCode: string | null = null;

async function loadRNPolyfills(projectRoot: string): Promise<string> {
  if (cachedPolyfillCode !== null) return cachedPolyfillCode;

  try {
    const rnGetPolyfills = require(
      require.resolve('react-native/rn-get-polyfills', { paths: [projectRoot] }),
    ) as () => string[];
    const polyfillPaths = rnGetPolyfills();

    const babel = await import('@babel/core');
    const swc = await import('@swc/core');

    const codes: string[] = [];
    for (const polyfillPath of polyfillPaths) {
      const source = readFileSync(polyfillPath, 'utf-8');

      const babelResult = await babel.transformAsync(source, {
        filename: polyfillPath,
        babelrc: false,
        configFile: false,
        sourceMaps: false,
        plugins: [
          [
            require.resolve('babel-plugin-syntax-hermes-parser'),
            { parseLangTypes: 'flow', reactRuntimeTarget: '19' },
          ],
          require.resolve('@babel/plugin-transform-flow-strip-types'),
        ],
      });
      if (!babelResult?.code) continue;

      const swcResult = await swc.transform(babelResult.code, {
        jsc: {
          parser: { syntax: 'ecmascript' },
          target: 'es5',
          assumptions: { setPublicClassFields: true, privateFieldsAsProperties: true },
        },
        sourceMaps: false,
      });

      codes.push(`(function(global){${swcResult.code}})(globalThis);`);
    }

    cachedPolyfillCode = codes.join('\n');
  } catch {
    cachedPolyfillCode = '';
  }

  return cachedPolyfillCode;
}

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
import { rolldown } from 'rolldown';
import {
  dev,
  transformSync,
  type DevEngine,
  type BindingClientHmrUpdate,
} from 'rolldown/experimental';

import type { ResolvedConfig } from '../../../config/types';
import { createRolldownOptions } from '../bundler';
import { hmrClientReplacePlugin, reactRefreshPlugin } from '../plugins';
import { generateChunkLoaderRuntime } from '../plugins/chunk-loader';
import { generatePreludeCode } from '../plugins/prelude';
import { applyHermesCompat, patchRolldownRuntime } from './hermes-compat-utils';
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
  needsHermesCompat?: boolean;
  /** Non-entry chunks (when code splitting is enabled) */
  chunks?: Map<string, { code: string; map?: string }>;
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

  /** Shared Rolldown options (computed once, reused for fallback build) */
  private rolldownInputOptions: any = null;
  private rolldownOutputOptions: any = null;

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
        host: this.options.host === '0.0.0.0' ? 'localhost' : this.options.host,
        port: this.options.port,
        extraPlugins: [hmrClientReplacePlugin(), ...reactRefreshPlugin()],
      });

      // Build intro with optional chunk loader runtime
      const codeSplitting = this.config.experimental?.codeSplitting === true && this.config.bundler === 'oxc';
      const devHost = this.options.host === '0.0.0.0' ? 'localhost' : this.options.host;

      let introOption: string | ((chunk: any) => string);
      if (codeSplitting) {
        const chunkLoaderRuntime = generateChunkLoaderRuntime({ host: devHost, port: this.options.port, dev: true });
        const entryIntro = `var global = globalThis;\n${prelude}\n${polyfillCode}\n${chunkLoaderRuntime}\n(function() {`;
        const chunkIntro = '(function() {';
        introOption = (chunk: any) => chunk.isEntry ? entryIntro : chunkIntro;
      } else {
        introOption = `var global = globalThis;\n${prelude}\n${polyfillCode}\n(function() {`;
      }

      // Store for fallback build
      const devOutputOptions = {
        ...outputOptions,
        intro: introOption,
        outro: '}).call(globalThis);',
      };
      this.rolldownInputOptions = inputOptions;
      this.rolldownOutputOptions = devOutputOptions;

      // Add DevEngine-specific experimental options
      const devInputOptions = { ...inputOptions };
      (devInputOptions as any).experimental = {
        devMode: { implement: runtimeCode },
        incrementalBuild: true,
      };

      // Code splitting requires generateBundle hook which DevEngine's dev() API
      // may not support. Use fallback build (rolldown + generate) for code splitting.
      if (codeSplitting) {
        console.log('[dev-engine] Code splitting enabled, using rolldown() build...');
        await this.fallbackBuild();
      } else {
        this.engine = await dev(devInputOptions, devOutputOptions, {
          onHmrUpdates: (result) => this.handleHmrUpdates(result),
          onOutput: (result) => this.handleOutput(result),
          rebuildStrategy: 'auto',
        });

        await this.engine.run();

        // DevEngine's onOutput may not fire on initial build.
        // Wait for output, and if still no bundle, fall back to rolldown() build.
        if (!this.cachedBundle && !this.buildError) {
          try {
            await this.engine.ensureLatestBuildOutput();
          } catch {
            // ensureLatestBuildOutput may fail if no output was produced
          }
        }

        if (!this.cachedBundle && !this.buildError) {
          console.log(
            '[dev-engine] onOutput not fired, falling back to rolldown() for initial build...',
          );
          await this.fallbackBuild();
        }
      }
    } catch (error: any) {
      this.buildError = error;
      this.state = 'ready';
      this.emit('buildFailed', error);
    }
  }

  /**
   * Fallback: use rolldown() + generate() for initial bundle.
   * This runs all plugin hooks (including renderChunk for hermes-compat).
   */
  private async fallbackBuild(): Promise<void> {
    try {
      const bundle = await rolldown(this.rolldownInputOptions);
      const { output } = await bundle.generate(this.rolldownOutputOptions);
      await bundle.close();

      const mainChunk = output.find((o) => o.type === 'chunk' && o.isEntry);
      if (!mainChunk || mainChunk.type !== 'chunk') {
        throw new Error('No output chunk generated from fallback build');
      }

      console.log(`[dev-engine] Fallback build done (${mainChunk.code.length} chars)`);

      // Collect non-entry chunks (code splitting)
      let chunks: Map<string, { code: string; map?: string }> | undefined;
      const nonEntryChunks = output.filter(
        (o) => o.type === 'chunk' && !o.isEntry,
      );
      if (nonEntryChunks.length > 0) {
        chunks = new Map();
        for (const chunk of nonEntryChunks) {
          if (chunk.type === 'chunk') {
            chunks.set(chunk.fileName, {
              code: chunk.code,
              map: chunk.map?.toString(),
            });
          }
        }
      }

      // rolldown() runs renderChunk hooks (hermesCompatPlugin), so the code
      // is already Hermes-compatible. Mark needsHermesCompat=false.
      this.cachedBundle = {
        code: mainChunk.code,
        map: mainChunk.map?.toString(),
        needsHermesCompat: false,
        chunks,
      };
      this.buildError = null;
      this.state = 'ready';
      this.emit('buildDone', this.cachedBundle);
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

    // Post-process patch code for Hermes compatibility.
    // HMR patches are small, so we apply __defProp patch synchronously.
    // #private fields in patches are unlikely since HMR patches are module-level,
    // but if needed, the server can apply async transform before sending.
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

    // DevEngine's dev() API DOES run renderChunk hooks (hermesCompatPlugin),
    // so the output is already Hermes-compatible. No need for applyHermesCompat.

    // Collect non-entry chunks (code splitting)
    let chunks: Map<string, { code: string; map?: string }> | undefined;
    const nonEntryChunks = result.output.filter(
      (o) => o.type === 'chunk' && !o.isEntry,
    );
    if (nonEntryChunks.length > 0) {
      chunks = new Map();
      for (const chunk of nonEntryChunks) {
        if (chunk.type === 'chunk') {
          chunks.set(chunk.fileName, {
            code: chunk.code,
            map: chunk.map?.toString(),
          });
        }
      }
    }

    this.cachedBundle = {
      code: mainChunk.code,
      map: mainChunk.map?.toString(),
      needsHermesCompat: false,
      chunks,
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
      try {
        await this.engine.ensureLatestBuildOutput();
      } catch {
        // May fail if DevEngine didn't produce output
      }
    }

    // Last resort: fallback build if still no bundle
    if (!this.cachedBundle && !this.buildError && this.rolldownInputOptions) {
      console.log('[dev-engine] No cached bundle, running fallback build...');
      await this.fallbackBuild();
    }

    if (this.buildError) {
      throw this.buildError;
    }

    if (!this.cachedBundle) {
      throw new Error('No bundle available');
    }

    // Lazy Hermes compat: Rolldown's dev() API doesn't run renderChunk hooks,
    // so we transform #private fields and patch __defProp here on first request.
    if (this.cachedBundle.needsHermesCompat) {
      try {
        this.cachedBundle.code = await applyHermesCompat(this.cachedBundle.code);
      } catch {
        this.cachedBundle.code = patchRolldownRuntime(this.cachedBundle.code);
      }
      this.cachedBundle.needsHermesCompat = false;
    }

    return this.cachedBundle;
  }

  /**
   * Get a specific chunk by filename (for code splitting)
   */
  async getChunk(fileName: string): Promise<{ code: string; map?: string } | null> {
    const bundle = await this.getBundle();
    return bundle.chunks?.get(fileName) || null;
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
   * Rebuild the bundle (e.g., on FullReload from DevEngine).
   * Uses rolldown() to produce a fresh bundle with all plugin hooks.
   */
  async rebuild(): Promise<void> {
    if (!this.rolldownInputOptions) return;
    this.cachedBundle = null;
    this.buildError = null;
    await this.fallbackBuild();
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

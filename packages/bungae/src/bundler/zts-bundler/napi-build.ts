/**
 * ZTS NAPI Build — In-process bundling via @zts/core NAPI bindings
 *
 * Replaces runZtsBuild() (subprocess) with direct NAPI calls.
 * Converts ResolvedConfig to BuildOptions and manages plugins in-process.
 */

import {
  init,
  build,
  watch,
  type BuildOptions,
  type BuildResult,
  type WatchHandle,
  type WatchReadyEvent,
  type WatchRebuildEvent,
} from '@zts/core';
import { resolve } from 'path';

import type { ResolvedConfig } from '../../config/types';
import { VERSION } from '../../version';
import { createAssetPlugin, createBabelPlugin, type PluginConfig } from './napi-plugins';

// ===== Re-exported constants from process.ts =====
// These are used by napi-build and also needed by callers that were importing from process.ts

/**
 * RN reserved global identifiers (RN 0.83).
 * Registered via polyfillGlobal() — scope hoisting must avoid shadowing these.
 */
export const RN_GLOBAL_IDENTIFIERS = [
  // polyfillPromise
  'Promise',
  // setUpRegeneratorRuntime
  'regeneratorRuntime',
  // setUpXHR
  'XMLHttpRequest',
  'FormData',
  'fetch',
  'Headers',
  'Request',
  'Response',
  'WebSocket',
  'Blob',
  'File',
  'FileReader',
  'URL',
  'URLSearchParams',
  'AbortController',
  'AbortSignal',
  // setUpTimers
  'queueMicrotask',
  'setImmediate',
  'clearImmediate',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  // setUpDOM
  'DOMRect',
  'DOMRectReadOnly',
  'DOMRectList',
  'HTMLCollection',
  'NodeList',
  'Node',
  'Document',
  'CharacterData',
  'Text',
  'Element',
  'HTMLElement',
  // setUpIntersectionObserver
  'IntersectionObserver',
  // setUpMutationObserver
  'MutationObserver',
  'MutationRecord',
  // setUpPerformanceModern
  'EventCounts',
  'Performance',
  'PerformanceEntry',
  'PerformanceEventTiming',
  'PerformanceLongTaskTiming',
  'PerformanceMark',
  'PerformanceMeasure',
  'PerformanceObserver',
  'PerformanceObserverEntryList',
  'PerformanceResourceTiming',
  'TaskAttributionTiming',
];

/**
 * require.resolve with fallback — returns null if not found.
 */
export function tryResolve(specifier: string, fromDir: string): string | null {
  try {
    return require.resolve(specifier, { paths: [fromDir] });
  } catch {
    return null;
  }
}

/**
 * Resolve RN polyfill paths (console.js, error-guard.js).
 * Tries rn-get-polyfills first (RN 0.73+), falls back to @react-native/js-polyfills.
 */
export function resolveRnPolyfills(projectRoot: string): string[] {
  const candidates = ['react-native/rn-get-polyfills', '@react-native/js-polyfills'];
  for (const candidate of candidates) {
    const resolved = tryResolve(candidate, projectRoot);
    if (resolved) {
      try {
        return (require(resolved) as () => string[])();
      } catch {
        continue;
      }
    }
  }
  console.warn('[zts] Could not resolve RN polyfills, skipping');
  return [];
}

// ===== Config Conversion =====

/**
 * Build PluginConfig from ResolvedConfig for NAPI plugin factories.
 */
function getPluginConfig(config: ResolvedConfig): PluginConfig {
  return {
    projectRoot: config.root,
    assetExts: config.resolver.assetExts.map((e) => (e.startsWith('.') ? e : `.${e}`)),
    rnPlatform: config.platform === 'android' ? 'android' : 'ios',
    sourceExts: config.resolver.sourceExts.map((e) => (e.startsWith('.') ? e : `.${e}`)),
  };
}

/**
 * Convert ResolvedConfig to ZTS BuildOptions.
 *
 * Maps the same options that buildZtsArgs() in process.ts produces as CLI flags,
 * but as a structured object for the NAPI build() / watch() API.
 */
function buildNapiOptions(config: ResolvedConfig): BuildOptions {
  const platform = config.platform === 'web' ? 'browser' : 'react-native';
  const rnPlatform =
    config.platform === 'ios' ? 'ios' : config.platform === 'android' ? 'android' : 'ios';

  const define: Record<string, string> = {};
  const plugins = [];
  const polyfills: string[] = [];
  const runBeforeMain: string[] = [];
  const globalIdentifiers: string[] = [];

  // Build plugins from config
  const pluginConfig = getPluginConfig(config);
  plugins.push(createAssetPlugin(pluginConfig));
  plugins.push(createBabelPlugin(pluginConfig));

  const opts: BuildOptions = {
    entryPoints: [resolve(config.root, config.entry)],
    platform,
    sourcemap: config.sourceMap || config.dev,
    minify: config.minify,
    plugins,
  };

  // React Native specific options
  if (platform === 'react-native') {
    opts.target = 'es5';

    // global -> __BUNGAE_GLOBAL__ substitution (preserve native Hermes global)
    define['global'] = '__BUNGAE_GLOBAL__';

    // JSX runtime
    if (config.dev) {
      opts.jsx = 'automatic-dev';
      // ZTS dev mode: __zts_register() wrapping + HMR runtime + React Refresh
      opts.devMode = true;
      opts.reactRefresh = true;
      opts.collectModuleCodes = true;

      // DevLoadingView hide workaround
      const hideLoadingView =
        'setTimeout(function(){try{NativeModules.DevLoadingView.hide()}catch(e){}},0);';
      opts.footer = hideLoadingView;
    }

    // RN prelude (Metro prelude equivalent)
    const prelude = [
      `var __BUNDLE_START_TIME__=this.nativePerformanceNow?nativePerformanceNow():Date.now();`,
      `var __DEV__=${config.dev};`,
      `var __BUNGAE_GLOBAL__=typeof globalThis!=='undefined'?globalThis:typeof global!=='undefined'?global:typeof window!=='undefined'?window:this;`,
      `if(typeof global==='undefined')var global=__BUNGAE_GLOBAL__;`,
      `var process=__BUNGAE_GLOBAL__.process||{};process.env=process.env||{};process.env.NODE_ENV=process.env.NODE_ENV||"${config.dev ? 'development' : 'production'}";`,
      `globalThis.__BUNGAE_BUNDLER__=true;globalThis.__BUNGAE_VERSION__=${JSON.stringify(VERSION)};`,
    ].join('');
    opts.banner = prelude;

    // Compile-time defines (override ZTS auto-define)
    define['__DEV__'] = String(config.dev);
    define['process.env.NODE_ENV'] = `"${config.dev ? 'development' : 'production'}"`;

    // Polyfills: console.js, error-guard.js — IIFE-wrapped, executed at bundle start
    for (const polyfillPath of resolveRnPolyfills(config.root)) {
      polyfills.push(polyfillPath);
    }

    // InitializeCore: runs before entry module (Metro runBeforeMainModule)
    const initCorePath = tryResolve('react-native/Libraries/Core/InitializeCore', config.root);
    if (initCorePath) {
      runBeforeMain.push(initCorePath);
    }

    // Reserved global identifiers — prevent scope hoisting collisions
    for (const name of RN_GLOBAL_IDENTIFIERS) {
      globalIdentifiers.push(name);
    }
  }

  // Apply accumulated arrays/objects
  opts.define = define;
  if (polyfills.length > 0) opts.polyfills = polyfills;
  if (runBeforeMain.length > 0) opts.runBeforeMain = runBeforeMain;
  if (globalIdentifiers.length > 0) opts.globalIdentifiers = globalIdentifiers;

  return opts;
}

// ===== Public API =====

export interface NapiBuildResult {
  code: string;
  map?: string;
  /** Per-module codes for HMR (dev mode only) */
  moduleCodes?: Array<{ id: string; code: string }>;
  /** All module paths in the bundle */
  modulePaths?: string[];
}

/**
 * Build with NAPI — in-process replacement for runZtsBuild().
 *
 * Uses @zts/core build() with JS plugins running in the same process.
 * No subprocess, no IPC overhead.
 */
export async function buildWithNapi(
  config: ResolvedConfig,
  outputPath?: string,
): Promise<NapiBuildResult> {
  init();

  const opts = buildNapiOptions(config);

  // If outputPath specified, write to disk
  if (outputPath) {
    opts.outfile = outputPath;
    opts.write = true;
  }

  const result: BuildResult = await build(opts);

  if (result.errors.length > 0) {
    const errorMessages = result.errors.map((e) => e.text).join('\n');
    throw new Error(`[zts] Build failed:\n${errorMessages}`);
  }

  // Extract code and sourcemap from output files
  const mainOutput = result.outputFiles.find(
    (f) => !f.path.endsWith('.map'),
  );
  const mapOutput = result.outputFiles.find(
    (f) => f.path.endsWith('.map'),
  );

  return {
    code: mainOutput?.text ?? '',
    map: mapOutput?.text,
    moduleCodes: (result as any).moduleCodes,
    modulePaths: (result as any).modulePaths,
  };
}

export interface NapiWatchResult {
  /** Stop watching and release resources */
  handle: WatchHandle;
}

/**
 * Watch with NAPI — in-process replacement for spawnZtsWatch().
 *
 * Uses @zts/core watch() with callbacks instead of NDJSON parsing.
 * Returns a handle to stop watching.
 */
export function watchWithNapi(
  config: ResolvedConfig,
  outputPath: string,
  callbacks?: {
    onReady?: (event: WatchReadyEvent) => void;
    onRebuild?: (event: WatchRebuildEvent) => void;
  },
): NapiWatchResult {
  init();

  const opts = buildNapiOptions(config);
  opts.outfile = outputPath;
  opts.write = true;

  // Wire up watch callbacks
  if (callbacks?.onReady) {
    opts.onReady = callbacks.onReady;
  }
  if (callbacks?.onRebuild) {
    opts.onRebuild = callbacks.onRebuild;
  }

  const handle = watch(opts);

  return { handle };
}

/**
 * Bungae Bundler Benchmark
 *
 * Measures build performance with phase-level granularity:
 * - Graph building (dependency resolution)
 * - Code transformation (Babel)
 * - Serialization (bundle generation)
 * - Source map generation
 */

import { existsSync, rmSync } from 'fs';
import { join, resolve } from 'path';

import {
  buildGraph,
  reorderGraph,
  graphToSerializerModules,
} from '../../bundler/graph-bundler/graph';
import { getDefaultConfig } from '../../config/defaults';
import { baseJSBundle } from '../../serializer/baseJSBundle';
import type { BenchmarkResult, PhaseTimer } from './types';
import { createPhaseTimer } from './types';

export interface BungaeBenchmarkOptions {
  projectRoot: string;
  entryFile: string;
  platform: 'ios' | 'android';
  dev: boolean;
  warmupRuns?: number;
  measureRuns?: number;
  clearCache?: boolean;
}

/**
 * Run Bungae benchmark with phase-level timing
 */
export async function runBungaeBenchmark(
  options: BungaeBenchmarkOptions,
): Promise<BenchmarkResult> {
  const {
    projectRoot,
    entryFile,
    platform,
    dev,
    warmupRuns = 1,
    measureRuns = 3,
    clearCache = true,
  } = options;

  const entryPath = resolve(projectRoot, entryFile);
  const cacheDir = join(projectRoot, '.bungae-cache');

  // Clear cache if requested
  if (clearCache && existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
  }

  // Use default config (avoid loading bungae.config.ts which may have import issues)
  const defaultConfig = getDefaultConfig(projectRoot);
  const resolvedConfig = {
    ...defaultConfig,
    platform,
    dev,
    root: projectRoot,
    // Add monorepo node_modules path for ExampleApp
    resolver: {
      ...defaultConfig.resolver,
      nodeModulesPaths: [
        join(projectRoot, 'node_modules'),
        join(projectRoot, '../../node_modules'),
      ],
    },
  };

  // Warmup runs (to warm up JIT, load modules, etc.)
  for (let i = 0; i < warmupRuns; i++) {
    if (clearCache && existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
    await runSingleBuild(entryPath, resolvedConfig, createPhaseTimer());
  }

  // Clear cache before measurement runs
  if (clearCache && existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
  }

  // Measurement runs
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < measureRuns; i++) {
    // Clear cache between runs for consistent cold-start measurement
    if (clearCache && existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }

    const timer = createPhaseTimer();
    const { bundleCode, moduleCount } = await runSingleBuild(entryPath, resolvedConfig, timer);

    results.push({
      bundler: 'bungae',
      platform,
      mode: dev ? 'dev' : 'release',
      totalTime: timer.getResults().reduce((sum, r) => sum + r.duration, 0),
      phases: timer.getResults(),
      bundleSize: Buffer.byteLength(bundleCode, 'utf-8'),
      moduleCount,
      timestamp: new Date(),
    });
  }

  // Return average of measurement runs
  return averageResults(results);
}

/**
 * Run a single build with phase timing
 */
async function runSingleBuild(
  entryPath: string,
  config: ReturnType<typeof getDefaultConfig> & { platform: string; dev: boolean; root: string },
  timer: PhaseTimer,
): Promise<{ bundleCode: string; moduleCount: number }> {
  // Phase 1: Build dependency graph
  timer.start('graph-build');
  const graph = await buildGraph(entryPath, config as any);
  timer.end('graph-build');

  // Phase 2: Reorder graph (DFS ordering)
  timer.start('graph-reorder');
  const orderedModules = reorderGraph(graph, entryPath);
  timer.end('graph-reorder');

  // Phase 3: Convert to serializer modules (includes code generation from AST)
  timer.start('code-generation');
  const serializerModules = await graphToSerializerModules(orderedModules, config as any);
  timer.end('code-generation');

  // Phase 4: Serialize to bundle
  timer.start('serialization');
  const result = await baseJSBundle(entryPath, [], serializerModules, {
    processModuleFilter: () => true,
    createModuleId: createModuleIdFactory(),
    dev: config.dev,
    projectRoot: config.root,
    serverRoot: config.root,
    globalPrefix: '',
    runBeforeMainModule: [],
    getRunModuleStatement: (moduleId: number | string) => `__r(${moduleId});`,
    runModule: true,
    shouldAddToIgnoreList: () => false,
  });
  timer.end('serialization');

  // Phase 5: Generate final bundle code
  timer.start('bundle-finalize');
  const modulesCode = result.modules.map(([, code]) => code).join('\n');
  const bundleCode = `${result.pre}\n${modulesCode}\n${result.post}`;
  timer.end('bundle-finalize');

  return {
    bundleCode,
    moduleCount: graph.size,
  };
}

/**
 * Create a module ID factory (Metro-compatible)
 */
function createModuleIdFactory(): (path: string) => number {
  const moduleIds = new Map<string, number>();
  let nextId = 0;

  return (path: string) => {
    let id = moduleIds.get(path);
    if (id === undefined) {
      id = nextId++;
      moduleIds.set(path, id);
    }
    return id;
  };
}

/**
 * Average multiple benchmark results
 */
function averageResults(results: BenchmarkResult[]): BenchmarkResult {
  if (results.length === 0) {
    throw new Error('No results to average');
  }

  const first = results[0]!;
  const phaseNames = first.phases.map((p) => p.name);

  const avgPhases = phaseNames.map((name) => {
    const phaseDurations = results.map((r) => r.phases.find((p) => p.name === name)?.duration ?? 0);
    const avgDuration = phaseDurations.reduce((a, b) => a + b, 0) / phaseDurations.length;

    return {
      name,
      duration: avgDuration,
      startTime: 0,
      endTime: avgDuration,
    };
  });

  return {
    bundler: 'bungae',
    platform: first.platform,
    mode: first.mode,
    totalTime: avgPhases.reduce((sum, p) => sum + p.duration, 0),
    phases: avgPhases,
    bundleSize: Math.round(results.reduce((sum, r) => sum + r.bundleSize, 0) / results.length),
    moduleCount: Math.round(results.reduce((sum, r) => sum + r.moduleCount, 0) / results.length),
    timestamp: new Date(),
    metadata: {
      runs: results.length,
    },
  };
}

/**
 * Run benchmark with cache (warm build)
 */
export async function runBungaeBenchmarkWithCache(
  options: Omit<BungaeBenchmarkOptions, 'clearCache'>,
): Promise<BenchmarkResult> {
  // First run to populate cache
  await runBungaeBenchmark({ ...options, clearCache: true, warmupRuns: 0, measureRuns: 1 });

  // Second run with cache (warm build)
  return runBungaeBenchmark({ ...options, clearCache: false, warmupRuns: 0 });
}

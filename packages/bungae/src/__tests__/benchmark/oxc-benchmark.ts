/**
 * OXC Bundler Benchmark
 *
 * Measures OXC (Rolldown-based) build performance with phase-level granularity:
 * - Rolldown bundling (resolution + transformation + code generation)
 * - Source map generation
 */

import { existsSync, rmSync } from 'fs';
import { join, resolve } from 'path';

import { buildWithOxc } from '../../bundler/oxc-bundler';
import { getDefaultConfig } from '../../config/defaults';
import type { BenchmarkResult, PhaseTimer } from './types';
import { createPhaseTimer } from './types';

export interface OxcBenchmarkOptions {
  projectRoot: string;
  entryFile: string;
  platform: 'ios' | 'android';
  dev: boolean;
  warmupRuns?: number;
  measureRuns?: number;
  clearCache?: boolean;
}

/**
 * Run OXC benchmark with phase-level timing
 */
export async function runOxcBenchmark(options: OxcBenchmarkOptions): Promise<BenchmarkResult> {
  const {
    projectRoot,
    entryFile,
    platform,
    dev,
    warmupRuns = 1,
    measureRuns = 3,
    clearCache = true,
  } = options;

  const config = createOxcConfig(projectRoot, entryFile, platform, dev);

  // Clear cache if requested
  if (clearCache) {
    clearOxcCache(projectRoot);
  }

  // Warmup runs
  for (let i = 0; i < warmupRuns; i++) {
    if (clearCache) {
      clearOxcCache(projectRoot);
    }
    await runSingleOxcBuild(config);
  }

  // Clear cache before measurement runs
  if (clearCache) {
    clearOxcCache(projectRoot);
  }

  // Measurement runs
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < measureRuns; i++) {
    if (clearCache) {
      clearOxcCache(projectRoot);
    }

    const timer = createPhaseTimer();
    timer.start('rolldown-bundle');
    const { code } = await runSingleOxcBuild(config);
    timer.end('rolldown-bundle');

    results.push({
      bundler: 'bungae',
      platform,
      mode: dev ? 'dev' : 'release',
      totalTime: timer.getResults().reduce((sum, r) => sum + r.duration, 0),
      phases: timer.getResults(),
      bundleSize: Buffer.byteLength(code, 'utf-8'),
      moduleCount: 0, // Rolldown doesn't expose module count directly
      timestamp: new Date(),
      metadata: { bundlerType: 'oxc' },
    });
  }

  return averageResults(results);
}

/**
 * Run OXC benchmark with cache (warm build)
 */
export async function runOxcBenchmarkWithCache(
  options: Omit<OxcBenchmarkOptions, 'clearCache'>,
): Promise<BenchmarkResult> {
  // First run to populate cache
  await runOxcBenchmark({ ...options, clearCache: true, warmupRuns: 0, measureRuns: 1 });

  // Second run with cache (warm build)
  return runOxcBenchmark({ ...options, clearCache: false, warmupRuns: 0 });
}

/**
 * Run a single OXC build
 */
async function runSingleOxcBuild(
  config: ReturnType<typeof createOxcConfig>,
): Promise<{ code: string }> {
  const result = await buildWithOxc(config, undefined, {
    sourcemap: config.dev,
    hermes: false, // Skip Hermes for benchmark (measure bundling only)
  });

  return { code: result.code };
}

/**
 * Create config for OXC bundler
 */
function createOxcConfig(
  projectRoot: string,
  entryFile: string,
  platform: 'ios' | 'android',
  dev: boolean,
) {
  const defaultConfig = getDefaultConfig(projectRoot);
  return {
    ...defaultConfig,
    bundler: 'oxc' as const,
    platform,
    dev,
    minify: false,
    root: projectRoot,
    entry: entryFile,
    resolver: {
      ...defaultConfig.resolver,
      nodeModulesPaths: [
        join(projectRoot, 'node_modules'),
        join(projectRoot, '../../node_modules'),
      ],
    },
  };
}

/**
 * Clear OXC/Rolldown cache
 */
function clearOxcCache(projectRoot: string): void {
  const cacheDirs = [
    join(projectRoot, '.bungae-cache'),
    join(projectRoot, 'node_modules/.cache/rolldown'),
  ];

  for (const cacheDir of cacheDirs) {
    try {
      if (existsSync(cacheDir)) {
        rmSync(cacheDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors
    }
  }
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
    moduleCount: 0,
    timestamp: new Date(),
    metadata: {
      runs: results.length,
      bundlerType: 'oxc',
    },
  };
}

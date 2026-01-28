/**
 * Metro Bundler Benchmark
 *
 * Measures Metro build performance for comparison with Bungae
 * Uses Metro's programmatic API to run builds
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

import type { BenchmarkResult } from './types';
import { createPhaseTimer } from './types';

export interface MetroBenchmarkOptions {
  projectRoot: string;
  entryFile: string;
  platform: 'ios' | 'android';
  dev: boolean;
  warmupRuns?: number;
  measureRuns?: number;
  clearCache?: boolean;
}

/**
 * Run Metro benchmark using react-native bundle command
 */
export async function runMetroBenchmark(options: MetroBenchmarkOptions): Promise<BenchmarkResult> {
  const {
    projectRoot,
    entryFile,
    platform,
    dev,
    warmupRuns = 1,
    measureRuns = 3,
    clearCache = true,
  } = options;

  const outputFile = join(
    projectRoot,
    platform === 'ios' ? 'ios/benchmark.jsbundle' : 'android/app/src/main/assets/benchmark.bundle',
  );

  // Ensure output directory exists (use mkdirSync to avoid shell injection)
  const outputDir = join(outputFile, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Clear Metro cache if requested
  if (clearCache) {
    clearMetroCache(projectRoot);
  }

  // Warmup runs
  for (let i = 0; i < warmupRuns; i++) {
    if (clearCache) {
      clearMetroCache(projectRoot);
    }
    await runMetroBuild(projectRoot, entryFile, platform, dev, outputFile);
  }

  // Clear cache before measurement runs
  if (clearCache) {
    clearMetroCache(projectRoot);
  }

  // Measurement runs
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < measureRuns; i++) {
    if (clearCache) {
      clearMetroCache(projectRoot);
    }

    const timer = createPhaseTimer();
    timer.start('total-build');

    const { moduleCount } = await runMetroBuild(projectRoot, entryFile, platform, dev, outputFile);

    timer.end('total-build');

    // Get bundle size
    const bundleSize = existsSync(outputFile) ? statSync(outputFile).size : 0;

    results.push({
      bundler: 'metro',
      platform,
      mode: dev ? 'dev' : 'release',
      totalTime: timer.getResults()[0]?.duration ?? 0,
      phases: timer.getResults(),
      bundleSize,
      moduleCount,
      timestamp: new Date(),
    });
  }

  // Cleanup
  if (existsSync(outputFile)) {
    rmSync(outputFile, { force: true });
  }

  // Return average of measurement runs
  return averageResults(results);
}

/**
 * Run Metro build using react-native bundle command
 */
async function runMetroBuild(
  projectRoot: string,
  entryFile: string,
  platform: 'ios' | 'android',
  dev: boolean,
  outputFile: string,
): Promise<{ moduleCount: number }> {
  return new Promise((resolve, reject) => {
    const args = [
      'react-native',
      'bundle',
      '--platform',
      platform,
      '--dev',
      String(dev),
      '--entry-file',
      entryFile,
      '--bundle-output',
      outputFile,
      '--reset-cache',
    ];

    // Use bunx to run react-native CLI
    const child = spawn('bunx', args, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: dev ? 'development' : 'production',
      },
    });

    let stdout = '';
    let stderr = '';
    let moduleCount = 0;

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
      // Parse module count from Metro output
      // Metro outputs something like "Bundling `index.js` [1, 245, 490]"
      const match = data.toString().match(/\[(\d+),\s*(\d+),\s*(\d+)\]/);
      if (match) {
        moduleCount = parseInt(match[3], 10);
      }
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ moduleCount });
      } else {
        reject(new Error(`Metro build failed with code ${code}: ${stderr}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Clear Metro cache
 * Uses safe file operations to avoid shell injection vulnerabilities
 */
function clearMetroCache(projectRoot: string): void {
  // Direct paths (no wildcards)
  const directPaths = [
    join(projectRoot, 'node_modules/.cache/metro'),
    join(projectRoot, '.metro-cache'),
  ];

  for (const cacheDir of directPaths) {
    try {
      if (existsSync(cacheDir)) {
        rmSync(cacheDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors (cache might not exist)
    }
  }

  // Handle /tmp wildcard patterns safely by listing directory
  try {
    const tmpDir = '/tmp';
    if (existsSync(tmpDir)) {
      const entries = readdirSync(tmpDir);
      for (const entry of entries) {
        if (entry.startsWith('metro-') || entry.startsWith('haste-map-')) {
          try {
            rmSync(join(tmpDir, entry), { recursive: true, force: true });
          } catch {
            // Ignore individual deletion errors
          }
        }
      }
    }
  } catch {
    // Ignore errors reading /tmp
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

  return {
    bundler: 'metro',
    platform: first.platform,
    mode: first.mode,
    totalTime: results.reduce((sum, r) => sum + r.totalTime, 0) / results.length,
    phases: first.phases.map((p) => ({
      ...p,
      duration:
        results.reduce(
          (sum, r) => sum + (r.phases.find((rp) => rp.name === p.name)?.duration ?? 0),
          0,
        ) / results.length,
    })),
    bundleSize: Math.round(results.reduce((sum, r) => sum + r.bundleSize, 0) / results.length),
    moduleCount: Math.round(results.reduce((sum, r) => sum + r.moduleCount, 0) / results.length),
    timestamp: new Date(),
    metadata: {
      runs: results.length,
    },
  };
}

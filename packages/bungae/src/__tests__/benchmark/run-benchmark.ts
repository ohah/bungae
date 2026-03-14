#!/usr/bin/env bun
/**
 * Benchmark Runner
 *
 * Runs Metro vs OXC (Rolldown-based) comparison benchmarks and outputs results
 *
 * Usage:
 *   bun run benchmark                    # Run full benchmark
 *   bun run benchmark --oxc-only         # Run OXC benchmark only
 *   bun run benchmark --output json      # Output as JSON
 *   bun run benchmark --output markdown  # Output as Markdown (for GitHub PR comments)
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { runMetroBenchmark } from './metro-benchmark';
import { runOxcBenchmark, runOxcBenchmarkWithCache } from './oxc-benchmark';
import type { BenchmarkResult, BenchmarkSummary, ComparisonResult } from './types';

interface BenchmarkOptions {
  projectRoot: string;
  entryFile: string;
  platforms: ('ios' | 'android')[];
  modes: ('dev' | 'release')[];
  oxcOnly: boolean;
  outputFormat: 'console' | 'json' | 'markdown';
  outputFile?: string;
  warmupRuns: number;
  measureRuns: number;
}

function parseArgs(): BenchmarkOptions {
  const args = process.argv.slice(2);

  // Default to ExampleApp in examples folder
  const defaultProjectRoot = resolve(__dirname, '../../../../../examples/ExampleApp');

  const options: BenchmarkOptions = {
    projectRoot: defaultProjectRoot,
    entryFile: 'index.js',
    platforms: ['ios', 'android'],
    modes: ['dev', 'release'],
    oxcOnly: false,
    outputFormat: 'console',
    warmupRuns: 1,
    measureRuns: 3,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--oxc-only':
        options.oxcOnly = true;
        break;
      case '--output':
        options.outputFormat = (args[++i] ?? 'console') as 'console' | 'json' | 'markdown';
        break;
      case '--output-file':
        options.outputFile = args[++i] ?? undefined;
        break;
      case '--project':
        options.projectRoot = resolve(args[++i] ?? '.');
        break;
      case '--platform':
        options.platforms = [(args[++i] ?? 'ios') as 'ios' | 'android'];
        break;
      case '--mode':
        options.modes = [(args[++i] ?? 'dev') as 'dev' | 'release'];
        break;
      case '--warmup': {
        const warmup = parseInt(args[++i] ?? '1', 10);
        if (Number.isNaN(warmup) || warmup < 0) {
          console.error('Error: --warmup must be a valid non-negative integer');
          process.exit(1);
        }
        options.warmupRuns = warmup;
        break;
      }
      case '--runs': {
        const runs = parseInt(args[++i] ?? '3', 10);
        if (Number.isNaN(runs) || runs < 1) {
          console.error('Error: --runs must be a valid positive integer');
          process.exit(1);
        }
        options.measureRuns = runs;
        break;
      }
      case '--help':
        console.log(`
Bungae OXC Benchmark Runner

Usage:
  bun run benchmark [options]

Options:
  --oxc-only          Run OXC benchmark only (skip Metro)
  --output <format>   Output format: console, json, markdown (default: console)
  --output-file <f>   Write output to file
  --project <path>    Project root path (default: examples/ExampleApp)
  --platform <p>      Platform: ios, android (default: both)
  --mode <m>          Build mode: dev, release (default: both)
  --warmup <n>        Number of warmup runs (default: 1)
  --runs <n>          Number of measurement runs (default: 3)
  --help              Show this help
`);
        process.exit(0);
    }
  }

  return options;
}

async function runBenchmarks(options: BenchmarkOptions): Promise<BenchmarkSummary> {
  const comparisons: ComparisonResult[] = [];
  const oxcResults: BenchmarkResult[] = [];

  console.log('🚀 Starting benchmark...\n');
  console.log(`Project: ${options.projectRoot}`);
  console.log(`Platforms: ${options.platforms.join(', ')}`);
  console.log(`Modes: ${options.modes.join(', ')}`);
  console.log(`Warmup runs: ${options.warmupRuns}`);
  console.log(`Measurement runs: ${options.measureRuns}`);
  console.log('');

  for (const platform of options.platforms) {
    for (const mode of options.modes) {
      const dev = mode === 'dev';

      console.log(`\n📦 Benchmarking ${platform} ${mode}...`);

      // Run OXC benchmark (cold build)
      console.log('  ⚡ Running OXC (cold)...');
      const oxcResult = await runOxcBenchmark({
        projectRoot: options.projectRoot,
        entryFile: options.entryFile,
        platform,
        dev,
        warmupRuns: options.warmupRuns,
        measureRuns: options.measureRuns,
        clearCache: true,
      });
      oxcResults.push(oxcResult);

      // Run OXC benchmark (warm build with cache)
      console.log('  ⚡ Running OXC (warm)...');
      const oxcWarmResult = await runOxcBenchmarkWithCache({
        projectRoot: options.projectRoot,
        entryFile: options.entryFile,
        platform,
        dev,
        warmupRuns: 0,
        measureRuns: options.measureRuns,
      });
      oxcWarmResult.metadata = { ...oxcWarmResult.metadata, cached: true };
      oxcResults.push(oxcWarmResult);

      if (!options.oxcOnly) {
        // Run Metro benchmark
        console.log('  🚇 Running Metro...');
        try {
          const metroResult = await runMetroBenchmark({
            projectRoot: options.projectRoot,
            entryFile: options.entryFile,
            platform,
            dev,
            warmupRuns: options.warmupRuns,
            measureRuns: options.measureRuns,
            clearCache: true,
          });

          // Calculate comparison (handle edge cases for division by zero)
          const speedup =
            oxcResult.totalTime > 0 ? metroResult.totalTime / oxcResult.totalTime : 0;
          const sizeDiff = metroResult.bundleSize - oxcResult.bundleSize;
          const sizeDiffPercent =
            metroResult.bundleSize > 0 ? (sizeDiff / metroResult.bundleSize) * 100 : 0;

          comparisons.push({
            metro: metroResult,
            bungae: oxcResult,
            speedup,
            sizeDiff,
            sizeDiffPercent,
          });
        } catch (error) {
          console.warn(`  ⚠️  Metro benchmark failed: ${error}`);
        }
      }
    }
  }

  // Calculate phase statistics
  const phaseStats = calculatePhaseStats(oxcResults.filter((r) => !r.metadata?.cached));

  // Get git info
  let gitCommit: string | undefined;
  let gitBranch: string | undefined;
  try {
    gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    // Git not available
  }

  return {
    comparisons,
    oxcPhases: phaseStats,
    timestamp: new Date(),
    gitCommit,
    gitBranch,
  };
}

function calculatePhaseStats(results: BenchmarkResult[]): BenchmarkSummary['oxcPhases'] {
  if (results.length === 0) return [];

  const firstResult = results[0]!;
  const phaseNames = firstResult.phases.map((p) => p.name);

  return phaseNames.map((name) => {
    const durations = results.flatMap((r) =>
      r.phases.filter((p) => p.name === name).map((p) => p.duration),
    );

    return {
      name,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
    };
  });
}

function formatConsole(summary: BenchmarkSummary): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('                    BENCHMARK RESULTS');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  if (summary.comparisons.length > 0) {
    lines.push('📊 Metro vs OXC Comparison:');
    lines.push('───────────────────────────────────────────────────────────────');

    for (const comp of summary.comparisons) {
      lines.push(`\n  ${comp.metro.platform.toUpperCase()} ${comp.metro.mode.toUpperCase()}:`);
      lines.push(
        `    Metro:  ${comp.metro.totalTime.toFixed(0)}ms (${formatBytes(comp.metro.bundleSize)})`,
      );
      lines.push(
        `    OXC:    ${comp.bungae.totalTime.toFixed(0)}ms (${formatBytes(comp.bungae.bundleSize)})`,
      );
      lines.push(`    Speedup: ${comp.speedup.toFixed(2)}x ${comp.speedup > 1 ? '🚀' : '🐢'}`);
      lines.push(
        `    Size diff: ${comp.sizeDiffPercent > 0 ? '-' : '+'}${Math.abs(comp.sizeDiffPercent).toFixed(1)}%`,
      );
    }
  }

  if (summary.oxcPhases.length > 0) {
    lines.push('\n\n📈 OXC Phase Breakdown:');
    lines.push('───────────────────────────────────────────────────────────────');

    const totalAvg = summary.oxcPhases.reduce((sum, p) => sum + p.avgDuration, 0);
    const safeTotalAvg = totalAvg > 0 ? totalAvg : 1; // Prevent division by zero

    for (const phase of summary.oxcPhases) {
      const percent = ((phase.avgDuration / safeTotalAvg) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round((phase.avgDuration / safeTotalAvg) * 20));
      lines.push(
        `  ${phase.name.padEnd(20)} ${phase.avgDuration.toFixed(0).padStart(6)}ms (${percent.padStart(5)}%) ${bar}`,
      );
    }

    lines.push(`  ${'─'.repeat(20)} ${'─'.repeat(6)}──`);
    lines.push(`  ${'Total'.padEnd(20)} ${totalAvg.toFixed(0).padStart(6)}ms`);
  }

  lines.push('\n═══════════════════════════════════════════════════════════════');

  if (summary.gitCommit) {
    lines.push(`Git: ${summary.gitBranch} @ ${summary.gitCommit.slice(0, 8)}`);
  }
  lines.push(`Timestamp: ${summary.timestamp.toISOString()}`);
  lines.push('');

  return lines.join('\n');
}

function formatMarkdown(summary: BenchmarkSummary): string {
  const lines: string[] = [];

  lines.push('## ⚡ Benchmark Results\n');

  if (summary.gitCommit) {
    lines.push(
      `> Branch: \`${summary.gitBranch}\` | Commit: \`${summary.gitCommit.slice(0, 8)}\`\n`,
    );
  }

  if (summary.comparisons.length > 0) {
    lines.push('### Metro vs OXC Comparison\n');
    lines.push('| Platform | Mode | Metro | OXC | Speedup | Size Diff |');
    lines.push('|----------|------|-------|-----|---------|-----------|');

    for (const comp of summary.comparisons) {
      const speedupEmoji = comp.speedup > 1.5 ? '🚀' : comp.speedup > 1 ? '✅' : '⚠️';
      lines.push(
        `| ${comp.metro.platform} | ${comp.metro.mode} | ${comp.metro.totalTime.toFixed(0)}ms | ${comp.bungae.totalTime.toFixed(0)}ms | ${speedupEmoji} ${comp.speedup.toFixed(2)}x | ${comp.sizeDiffPercent > 0 ? '-' : '+'}${Math.abs(comp.sizeDiffPercent).toFixed(1)}% |`,
      );
    }
  }

  if (summary.oxcPhases.length > 0) {
    lines.push('\n### OXC Phase Breakdown\n');
    lines.push('| Phase | Avg | Min | Max |');
    lines.push('|-------|-----|-----|-----|');

    const totalAvg = summary.oxcPhases.reduce((sum, p) => sum + p.avgDuration, 0);
    const safeTotalAvg = totalAvg > 0 ? totalAvg : 1; // Prevent division by zero

    for (const phase of summary.oxcPhases) {
      const percent = ((phase.avgDuration / safeTotalAvg) * 100).toFixed(1);
      lines.push(
        `| ${phase.name} | ${phase.avgDuration.toFixed(0)}ms (${percent}%) | ${phase.minDuration.toFixed(0)}ms | ${phase.maxDuration.toFixed(0)}ms |`,
      );
    }

    lines.push(`| **Total** | **${totalAvg.toFixed(0)}ms** | | |`);
  }

  lines.push(`\n<sub>Generated at ${summary.timestamp.toISOString()}</sub>`);

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

async function main() {
  const options = parseArgs();

  // Check if project exists
  if (!existsSync(options.projectRoot)) {
    console.error(`❌ Project not found: ${options.projectRoot}`);
    console.error('   Make sure to run from the bungae root directory or specify --project');
    process.exit(1);
  }

  try {
    const summary = await runBenchmarks(options);

    let output: string;
    switch (options.outputFormat) {
      case 'json':
        output = JSON.stringify(summary, null, 2);
        break;
      case 'markdown':
        output = formatMarkdown(summary);
        break;
      default:
        output = formatConsole(summary);
    }

    if (options.outputFile) {
      writeFileSync(options.outputFile, output);
      console.log(`\n📝 Results written to ${options.outputFile}`);
    } else {
      console.log(output);
    }

    // Exit with error if OXC is slower
    if (summary.comparisons.some((c) => c.speedup < 1)) {
      console.warn('\n⚠️  Warning: OXC is slower than Metro in some cases!');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

main();

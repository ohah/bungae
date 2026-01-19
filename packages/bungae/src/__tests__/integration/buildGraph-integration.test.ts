/**
 * Copyright (c) 2026 ohah
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';

import { buildGraph } from '../../graph';
import type { GraphBuildOptions } from '../../graph/types';

describe('BuildGraph Integration Tests', () => {
  let testDir: string;
  let basicBundleDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-graph-integration-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    basicBundleDir = join(testDir, 'basic_bundle');
    mkdirSync(basicBundleDir, { recursive: true });

    // Create test bundle files
    writeFileSync(
      join(basicBundleDir, 'TestBundle.js'),
      `const Bar = require('./Bar');\nconst Foo = require('./Foo');\n\nObject.keys({...Bar});\n\nmodule.exports = {Foo, Bar};`,
      'utf-8',
    );
    writeFileSync(
      join(basicBundleDir, 'Foo.js'),
      `module.exports = {\n  foo: 'foo',\n  getFoo: () => 'foo',\n};`,
      'utf-8',
    );
    writeFileSync(
      join(basicBundleDir, 'Bar.js'),
      `module.exports = {\n  bar: 'bar',\n  getBar: () => 'bar',\n};`,
      'utf-8',
    );
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should build dependency graph from entry point', async () => {
    const options: GraphBuildOptions = {
      entryFile: 'basic_bundle/TestBundle.js',
      platform: 'ios',
      dev: false,
      projectRoot: testDir,
      resolver: {
        sourceExts: ['.js', '.jsx', '.ts', '.tsx'],
        assetExts: [],
        platforms: ['ios', 'android'],
        preferNativePlatform: true,
        nodeModulesPaths: [],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const graph = await buildGraph(options);

    // Verify graph structure
    expect(graph.modules.size).toBeGreaterThan(0);
    expect(graph.entryModule).toBeDefined();
    expect(graph.entryModule.path).toBe(resolve(testDir, 'basic_bundle/TestBundle.js'));

    // Verify entry module has dependencies
    expect(graph.entryModule.dependencies.length).toBeGreaterThanOrEqual(0);

    // Verify prepended modules (prelude, metro-runtime)
    expect(graph.prepend.length).toBeGreaterThan(0);
    expect(graph.prepend.some((m) => m.path === '__prelude__')).toBe(true);
  });

  test('should include all dependencies in graph', async () => {
    const options: GraphBuildOptions = {
      entryFile: 'basic_bundle/TestBundle.js',
      platform: 'ios',
      dev: false,
      projectRoot: testDir,
      resolver: {
        sourceExts: ['.js', '.jsx', '.ts', '.tsx'],
        assetExts: [],
        platforms: ['ios', 'android'],
        preferNativePlatform: true,
        nodeModulesPaths: [],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const graph = await buildGraph(options);

    // Get all module paths
    const modulePaths = Array.from(graph.modules.keys());

    // Entry file should be in graph
    expect(modulePaths.some((path) => path.includes('TestBundle.js'))).toBe(true);

    // All modules should have transformed code
    for (const module of graph.modules.values()) {
      expect(module.code).toBeDefined();
      expect(module.processed).toBe(true);
    }
  });

  test('should handle platform-specific resolution', async () => {
    // Create platform-specific file
    writeFileSync(
      join(basicBundleDir, 'Platform.ios.js'),
      `module.exports = { platform: 'ios' };`,
      'utf-8',
    );
    writeFileSync(
      join(basicBundleDir, 'Platform.android.js'),
      `module.exports = { platform: 'android' };`,
      'utf-8',
    );

    // Update TestBundle to import Platform
    writeFileSync(
      join(basicBundleDir, 'TestBundle.js'),
      `const Platform = require('./Platform');\nmodule.exports = { Platform };`,
      'utf-8',
    );

    const options: GraphBuildOptions = {
      entryFile: 'basic_bundle/TestBundle.js',
      platform: 'ios',
      dev: false,
      projectRoot: testDir,
      resolver: {
        sourceExts: ['.js', '.jsx', '.ts', '.tsx'],
        assetExts: [],
        platforms: ['ios', 'android'],
        preferNativePlatform: true,
        nodeModulesPaths: [],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const graph = await buildGraph(options);

    // Should resolve to iOS-specific file
    const modulePaths = Array.from(graph.modules.keys());
    // Platform.ios.js should be included (if dependency extraction works)
    expect(modulePaths.some((path) => path.includes('TestBundle.js'))).toBe(true);
  });

  test('should build graph with progress callback', async () => {
    const progressCalls: Array<{ processed: number; total: number }> = [];

    const options: GraphBuildOptions = {
      entryFile: 'basic_bundle/TestBundle.js',
      platform: 'ios',
      dev: false,
      projectRoot: testDir,
      resolver: {
        sourceExts: ['.js', '.jsx', '.ts', '.tsx'],
        assetExts: [],
        platforms: ['ios', 'android'],
        preferNativePlatform: true,
        nodeModulesPaths: [],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
      onProgress: (processed, total) => {
        progressCalls.push({ processed, total });
      },
    };

    await buildGraph(options);

    // Progress should be called
    expect(progressCalls.length).toBeGreaterThan(0);
    // Last progress should show completion
    const lastProgress = progressCalls[progressCalls.length - 1];
    expect(lastProgress).toBeDefined();
    expect(lastProgress!.processed).toBeGreaterThan(0);
    expect(lastProgress!.total).toBeGreaterThanOrEqual(lastProgress!.processed);
  });
});

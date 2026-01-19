/**
 * Metro Compatibility Tests
 *
 * These tests verify that Bungae produces bundles compatible with Metro's format
 * and includes all necessary modules like Metro does.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { baseJSBundle, createModuleIdFactory, getRunModuleStatement } from '../../serializer';
import type { SerializerOptions } from '../../serializer/types';
import { buildGraph, graphModulesToSerializerModules } from '../index';
import type { GraphBuildOptions } from '../types';

describe('Metro Compatibility', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `bungae-metro-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should include all transitive dependencies like Metro', async () => {
    // Create a dependency chain: entry -> A -> B -> C
    const entryFile = join(testDir, 'index.js');
    const moduleA = join(testDir, 'a.js');
    const moduleB = join(testDir, 'b.js');
    const moduleC = join(testDir, 'c.js');

    writeFileSync(entryFile, `import A from './a'; A();`);
    writeFileSync(moduleA, `import B from './b'; export default () => B();`);
    writeFileSync(moduleB, `import C from './c'; export default () => C();`);
    writeFileSync(moduleC, `export default () => 'C';`);

    const options: GraphBuildOptions = {
      entryFile: 'index.js',
      projectRoot: testDir,
      platform: 'ios',
      dev: false,
      resolver: {
        sourceExts: ['.js'],
        assetExts: [],
        platforms: ['ios'],
        preferNativePlatform: false,
        nodeModulesPaths: ['node_modules'],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const result = await buildGraph(options);

    // Metro includes all transitive dependencies
    // Should have: entry, a, b, c (4 modules)
    expect(result.modules.size).toBeGreaterThanOrEqual(4);
    expect(result.modules.has(resolve(testDir, 'index.js'))).toBe(true);
    expect(result.modules.has(resolve(testDir, 'a.js'))).toBe(true);
    expect(result.modules.has(resolve(testDir, 'b.js'))).toBe(true);
    expect(result.modules.has(resolve(testDir, 'c.js'))).toBe(true);
  });

  test('should generate Metro-compatible bundle format', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, `console.log('hello');`);

    const options: GraphBuildOptions = {
      entryFile: 'index.js',
      projectRoot: testDir,
      platform: 'ios',
      dev: false,
      resolver: {
        sourceExts: ['.js'],
        assetExts: [],
        platforms: ['ios'],
        preferNativePlatform: false,
        nodeModulesPaths: ['node_modules'],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const graphResult = await buildGraph(options);
    const graphModules = graphModulesToSerializerModules(graphResult.modules);

    const createModuleId = createModuleIdFactory();
    const serializerOptions: SerializerOptions = {
      createModuleId,
      getRunModuleStatement,
      dev: false,
      projectRoot: testDir,
      serverRoot: testDir,
      globalPrefix: '',
      runModule: true,
    };

    const bundle = await baseJSBundle(
      resolve(testDir, 'index.js'),
      graphResult.prepend,
      graphModules,
      serializerOptions,
    );

    // Metro bundle format:
    // 1. Prelude (pre)
    // 2. Module definitions (modules)
    // 3. Entry execution (post)
    expect(bundle.pre).toBeTruthy();
    expect(bundle.modules.length).toBeGreaterThan(0);
    expect(bundle.post).toBeTruthy();

    // Check for Metro runtime functions
    expect(bundle.pre).toContain('__r');
    expect(bundle.pre).toContain('__d');
    expect(bundle.pre).toContain('metroRequire');

    // Check module format: __d(function(...) { ... }, moduleId, dependencies)
    const moduleCode = bundle.modules[0]?.[1] || '';
    expect(moduleCode).toContain('__d(');
  });

  test('should include dependencies in dependencyMap like Metro', async () => {
    const entryFile = join(testDir, 'index.js');
    const moduleA = join(testDir, 'a.js');
    const moduleB = join(testDir, 'b.js');

    writeFileSync(entryFile, `import A from './a'; import B from './b';`);
    writeFileSync(moduleA, `export default 'A';`);
    writeFileSync(moduleB, `export default 'B';`);

    const options: GraphBuildOptions = {
      entryFile: 'index.js',
      projectRoot: testDir,
      platform: 'ios',
      dev: false,
      resolver: {
        sourceExts: ['.js'],
        assetExts: [],
        platforms: ['ios'],
        preferNativePlatform: false,
        nodeModulesPaths: ['node_modules'],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const graphResult = await buildGraph(options);
    const entryModule = graphResult.modules.get(resolve(testDir, 'index.js'));

    expect(entryModule).toBeDefined();
    // Metro includes all dependencies in dependencyMap, even if already visited
    expect(entryModule!.dependencies.length).toBe(2);
    expect(entryModule!.dependencies).toContain(resolve(testDir, 'a.js'));
    expect(entryModule!.dependencies).toContain(resolve(testDir, 'b.js'));
  });

  test('should handle both import and require statements', async () => {
    const entryFile = join(testDir, 'index.js');
    const moduleA = join(testDir, 'a.js');
    const moduleB = join(testDir, 'b.js');

    writeFileSync(entryFile, `import A from './a'; const B = require('./b');`);
    writeFileSync(moduleA, `export default 'A';`);
    writeFileSync(moduleB, `module.exports = 'B';`);

    const options: GraphBuildOptions = {
      entryFile: 'index.js',
      projectRoot: testDir,
      platform: 'ios',
      dev: false,
      resolver: {
        sourceExts: ['.js'],
        assetExts: [],
        platforms: ['ios'],
        preferNativePlatform: false,
        nodeModulesPaths: ['node_modules'],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const result = await buildGraph(options);

    // Both import and require should be extracted
    expect(result.modules.has(resolve(testDir, 'index.js'))).toBe(true);
    expect(result.modules.has(resolve(testDir, 'a.js'))).toBe(true);
    expect(result.modules.has(resolve(testDir, 'b.js'))).toBe(true);
  });

  test('should extract dependencies from transformed code correctly', async () => {
    // Test that dependencies are extracted from original code, not transformed code
    const entryFile = join(testDir, 'index.js');
    const moduleA = join(testDir, 'a.js');

    // Use ESM import - should be converted to require() but dependency should still be extracted
    writeFileSync(entryFile, `import A from './a';`);
    writeFileSync(moduleA, `export default 'A';`);

    const options: GraphBuildOptions = {
      entryFile: 'index.js',
      projectRoot: testDir,
      platform: 'ios',
      dev: false,
      resolver: {
        sourceExts: ['.js'],
        assetExts: [],
        platforms: ['ios'],
        preferNativePlatform: false,
        nodeModulesPaths: ['node_modules'],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const result = await buildGraph(options);

    // Should extract './a' from original code before transformation
    expect(result.modules.has(resolve(testDir, 'a.js'))).toBe(true);

    const entryModule = result.modules.get(resolve(testDir, 'index.js'));
    expect(entryModule).toBeDefined();
    expect(entryModule!.dependencies).toContain(resolve(testDir, 'a.js'));
  });
});

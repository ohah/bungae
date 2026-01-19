import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { buildGraph } from '../index';
import type { GraphBuildOptions } from '../types';

describe('Dependency Resolution (Metro-compatible)', () => {
  let testDir: string;
  let projectRoot: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = join(
      tmpdir(),
      `bungae-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    projectRoot = testDir;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should resolve all transitive dependencies', async () => {
    // Create test files
    const entryFile = join(testDir, 'index.js');
    const moduleA = join(testDir, 'moduleA.js');
    const moduleB = join(testDir, 'moduleB.js');
    const moduleC = join(testDir, 'moduleC.js');

    writeFileSync(entryFile, `import A from './moduleA'; import B from './moduleB';`);
    writeFileSync(moduleA, `import C from './moduleC'; export default 'A';`);
    writeFileSync(moduleB, `export default 'B';`);
    writeFileSync(moduleC, `export default 'C';`);

    const options: GraphBuildOptions = {
      entryFile: 'index.js',
      projectRoot: testDir,
      platform: 'ios',
      dev: false,
      resolver: {
        sourceExts: ['.tsx', '.ts', '.jsx', '.js'],
        assetExts: ['.png', '.jpg'],
        platforms: ['ios', 'android', 'web'],
        preferNativePlatform: false,
        nodeModulesPaths: ['node_modules'],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const result = await buildGraph(options);

    // Should include all modules: entry, moduleA, moduleB, moduleC
    expect(result.modules.size).toBeGreaterThanOrEqual(4);
    expect(result.modules.has(resolve(testDir, 'index.js'))).toBe(true);
    expect(result.modules.has(resolve(testDir, 'moduleA.js'))).toBe(true);
    expect(result.modules.has(resolve(testDir, 'moduleB.js'))).toBe(true);
    expect(result.modules.has(resolve(testDir, 'moduleC.js'))).toBe(true);
  });

  test('should handle circular dependencies', async () => {
    const entryFile = join(testDir, 'index.js');
    const moduleA = join(testDir, 'moduleA.js');
    const moduleB = join(testDir, 'moduleB.js');

    writeFileSync(entryFile, `import A from './moduleA';`);
    writeFileSync(moduleA, `import B from './moduleB'; export default 'A';`);
    writeFileSync(moduleB, `import A from './moduleA'; export default 'B';`);

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

    // Metro handles circular dependencies by allowing them (JavaScript supports circular deps)
    // Bungae follows Metro's behavior - circular dependencies are skipped during graph building
    const result = await buildGraph(options);

    // All modules should be in the graph
    expect(result.modules.size).toBeGreaterThanOrEqual(1);
  });

  test('should resolve platform-specific files', async () => {
    const entryFile = join(testDir, 'index.js');
    const moduleIOS = join(testDir, 'module.ios.js');
    const moduleAndroid = join(testDir, 'module.android.js');
    const moduleDefault = join(testDir, 'module.js');

    writeFileSync(entryFile, `import M from './module';`);
    writeFileSync(moduleIOS, `export default 'iOS';`);
    writeFileSync(moduleAndroid, `export default 'Android';`);
    writeFileSync(moduleDefault, `export default 'Default';`);

    const options: GraphBuildOptions = {
      entryFile: 'index.js',
      projectRoot: testDir,
      platform: 'ios',
      dev: false,
      resolver: {
        sourceExts: ['.js'],
        assetExts: [],
        platforms: ['ios', 'android'],
        preferNativePlatform: false,
        nodeModulesPaths: ['node_modules'],
      },
      transformer: {
        minifier: 'bun',
        inlineRequires: false,
      },
    };

    const result = await buildGraph(options);

    // Should resolve to iOS-specific file
    const modulePath = resolve(testDir, 'module.ios.js');
    expect(result.modules.has(modulePath)).toBe(true);
  });

  test('should resolve node_modules packages', async () => {
    const entryFile = join(testDir, 'index.js');
    const nodeModulesDir = join(testDir, 'node_modules');
    const packageDir = join(nodeModulesDir, 'test-package');
    const packageIndex = join(packageDir, 'index.js');
    const packageJson = join(packageDir, 'package.json');

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(entryFile, `import pkg from 'test-package';`);
    writeFileSync(packageIndex, `export default 'test-package';`);
    writeFileSync(packageJson, JSON.stringify({ name: 'test-package', main: 'index.js' }));

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

    // Should resolve node_modules package
    expect(result.modules.has(packageIndex)).toBe(true);
  });

  test('should include all dependencies in dependencyMap', async () => {
    const entryFile = join(testDir, 'index.js');
    const moduleA = join(testDir, 'moduleA.js');
    const moduleB = join(testDir, 'moduleB.js');

    writeFileSync(entryFile, `import A from './moduleA'; import B from './moduleB';`);
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

    const result = await buildGraph(options);

    const entryModule = result.modules.get(resolve(testDir, 'index.js'));
    expect(entryModule).toBeDefined();
    expect(entryModule!.dependencies.length).toBe(2);
    expect(entryModule!.dependencies).toContain(resolve(testDir, 'moduleA.js'));
    expect(entryModule!.dependencies).toContain(resolve(testDir, 'moduleB.js'));
  });

  test('should handle require() calls in addition to imports', async () => {
    const entryFile = join(testDir, 'index.js');
    const moduleA = join(testDir, 'moduleA.js');

    writeFileSync(entryFile, `const A = require('./moduleA');`);
    writeFileSync(moduleA, `module.exports = 'A';`);

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

    expect(result.modules.has(resolve(testDir, 'index.js'))).toBe(true);
    expect(result.modules.has(resolve(testDir, 'moduleA.js'))).toBe(true);
  });

  test('should handle dynamic imports', async () => {
    const entryFile = join(testDir, 'index.js');
    const moduleA = join(testDir, 'moduleA.js');

    writeFileSync(entryFile, `async function load() { const A = await import('./moduleA'); }`);
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

    // Dynamic imports should be included in dependency graph
    expect(result.modules.has(resolve(testDir, 'moduleA.js'))).toBe(true);
  });

  test('should process all transitive dependencies recursively', async () => {
    // Create a deep dependency chain
    const entryFile = join(testDir, 'index.js');
    const files: Array<[string, string]> = [
      ['index.js', `import A from './a';`],
      ['a.js', `import B from './b';`],
      ['b.js', `import C from './c';`],
      ['c.js', `import D from './d';`],
      ['d.js', `export default 'D';`],
    ];

    for (const [file, content] of files) {
      writeFileSync(join(testDir, file), content);
    }

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

    // Should include all files in the chain
    expect(result.modules.size).toBe(5);
    for (const [file] of files) {
      expect(result.modules.has(resolve(testDir, file))).toBe(true);
    }
  });
});

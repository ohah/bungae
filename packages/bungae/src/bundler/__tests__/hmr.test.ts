/**
 * HMR (Hot Module Replacement) Tests
 *
 * Tests for HMR-related functionality including:
 * - Module ID consistency between initial build and HMR updates
 * - buildWithGraph returning graph and createModuleId for HMR state
 * - Incremental build using the same createModuleId factory
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { resolveConfig, getDefaultConfig } from '../../config';
import { createModuleIdFactory } from '../../serializer/utils';
import { buildWithGraph } from '../graph-bundler';

// Get packages/bungae directory (where dependencies are)
const currentFile = fileURLToPath(import.meta.url);
const packageDir = join(currentFile, '..', '..', '..', '..');

// Helper to resolve plugin with fallback to project root
function resolvePlugin(pluginName: string): string {
  try {
    const packageRequire = createRequire(join(packageDir, 'package.json'));
    return packageRequire.resolve(pluginName);
  } catch {
    const rootRequire = createRequire(join(packageDir, '..', '..', 'package.json'));
    return rootRequire.resolve(pluginName);
  }
}

describe('HMR (Hot Module Replacement)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-hmr-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create minimal node_modules for metro-runtime
    const metroRuntimeDir = join(testDir, 'node_modules', 'metro-runtime', 'src', 'polyfills');
    mkdirSync(metroRuntimeDir, { recursive: true });
    writeFileSync(
      join(metroRuntimeDir, 'require.js'),
      `(function (global) {
  global.__r = function() {};
  global.__d = function() {};
})`,
    );

    // Create babel.config.js
    const flowPlugin = resolvePlugin('@babel/plugin-transform-flow-strip-types');
    const commonjsPlugin = resolvePlugin('@babel/plugin-transform-modules-commonjs');
    const jsxPlugin = resolvePlugin('@babel/plugin-transform-react-jsx');
    const tsPlugin = resolvePlugin('@babel/plugin-transform-typescript');

    const babelConfig = `module.exports = {
  plugins: [
    ${JSON.stringify(flowPlugin)},
    ${JSON.stringify(commonjsPlugin)},
    ${JSON.stringify(jsxPlugin)},
    ${JSON.stringify(tsPlugin)},
  ],
};`;
    writeFileSync(join(testDir, 'babel.config.js'), babelConfig, 'utf-8');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createModuleIdFactory consistency', () => {
    test('should return same ID for same path across multiple calls', () => {
      const factory = createModuleIdFactory();

      const id1 = factory('/path/to/module.js');
      const id2 = factory('/path/to/another.js');
      const id3 = factory('/path/to/module.js'); // Same as id1

      expect(id1).toBe(id3);
      expect(id1).not.toBe(id2);
    });

    test('should maintain ID mapping after many calls', () => {
      const factory = createModuleIdFactory();
      const paths = Array.from({ length: 100 }, (_, i) => `/path/to/module${i}.js`);

      // First pass - assign IDs
      const firstPassIds = paths.map((path) => factory(path));

      // Second pass - should return same IDs
      const secondPassIds = paths.map((path) => factory(path));

      expect(firstPassIds).toEqual(secondPassIds);
    });

    test('should assign sequential IDs starting from 0', () => {
      const factory = createModuleIdFactory();

      const id0 = factory('/a.js');
      const id1 = factory('/b.js');
      const id2 = factory('/c.js');

      expect(id0).toBe(0);
      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });
  });

  describe('buildWithGraph HMR state', () => {
    test('should return graph for HMR state management', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('hello');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Should return graph for HMR
      expect(result.graph).toBeDefined();
      expect(result.graph instanceof Map).toBe(true);
      expect(result.graph!.size).toBeGreaterThan(0);
    });

    test('should return createModuleId function for HMR state management', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('hello');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Should return createModuleId function
      expect(result.createModuleId).toBeDefined();
      expect(typeof result.createModuleId).toBe('function');
    });

    test('should have consistent module IDs between graph and bundle code', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'test module';", 'utf-8');

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const mod = require('./module');
console.log(mod);
`,
        'utf-8',
      );

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Get module ID from returned createModuleId function
      expect(result.createModuleId).toBeDefined();
      const moduleId = result.createModuleId!(moduleFile);

      // Check that the bundle code contains this module ID
      // The module should be defined with __d(..., moduleId, ...)
      const moduleIdPattern = new RegExp(`},${moduleId},\\[`);
      expect(result.code).toMatch(moduleIdPattern);
    });

    test('should return same IDs for same paths when calling createModuleId multiple times', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('hello');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Call createModuleId multiple times for the same path
      expect(result.createModuleId).toBeDefined();
      const id1 = result.createModuleId!(entryFile);
      const id2 = result.createModuleId!(entryFile);
      const id3 = result.createModuleId!(entryFile);

      // Should always return the same ID
      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    });
  });

  describe('HMR module ID consistency', () => {
    test('should use same module IDs for initial build and subsequent lookups', async () => {
      // Create multiple modules
      const moduleA = join(testDir, 'a.js');
      const moduleB = join(testDir, 'b.js');
      const moduleC = join(testDir, 'c.js');

      writeFileSync(moduleC, "module.exports = 'c';", 'utf-8');
      writeFileSync(moduleB, "const c = require('./c'); module.exports = 'b' + c;", 'utf-8');
      writeFileSync(moduleA, "const b = require('./b'); module.exports = 'a' + b;", 'utf-8');

      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "const a = require('./a'); console.log(a);", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Build path to module ID mapping from returned createModuleId
      expect(result.graph).toBeDefined();
      expect(result.createModuleId).toBeDefined();
      const pathToId = new Map<string, number | string>();
      for (const [path] of result.graph!.entries()) {
        pathToId.set(path, result.createModuleId!(path));
      }

      // Verify each module's ID appears in the bundle
      for (const [path, moduleId] of pathToId.entries()) {
        // Skip polyfill modules that might not have standard __d() format
        if (path.includes('node_modules/metro-runtime')) continue;

        // Look for __d(..., moduleId, [...], "relativePath") pattern
        const relPath = path.replace(testDir + '/', '');
        const pattern = new RegExp(`,${moduleId},\\[.*?\\],"${relPath.replace(/\//g, '\\/')}"`);
        const hasModule = pattern.test(result.code);

        // At least entry and direct dependencies should be present
        if (path === entryFile || path === moduleA || path === moduleB || path === moduleC) {
          expect(hasModule).toBe(true);
        }
      }
    });

    test('graph should contain all resolved modules', async () => {
      const moduleFile = join(testDir, 'utils.js');
      writeFileSync(moduleFile, "module.exports = { greet: () => 'hello' };", 'utf-8');

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const utils = require('./utils');
console.log(utils.greet());
`,
        'utf-8',
      );

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Graph should contain both entry and utils module
      expect(result.graph).toBeDefined();
      expect(result.graph!.has(entryFile)).toBe(true);
      expect(result.graph!.has(moduleFile)).toBe(true);
    });

    test('createModuleId should handle new modules added after initial build', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('initial');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Simulate adding a new module (HMR scenario)
      expect(result.createModuleId).toBeDefined();
      const newModulePath = join(testDir, 'new-module.js');

      // The createModuleId should be able to assign ID to new module
      const newModuleId = result.createModuleId!(newModulePath);
      expect(typeof newModuleId === 'number' || typeof newModuleId === 'string').toBe(true);

      // Calling again should return the same ID
      expect(result.createModuleId!(newModulePath)).toBe(newModuleId);

      // Original modules should still have their IDs
      const entryId = result.createModuleId!(entryFile);
      expect(typeof entryId === 'number' || typeof entryId === 'string').toBe(true);
    });
  });

  describe('HMR inverse dependencies', () => {
    test('graph modules should have inverseDependencies for HMR traversal', async () => {
      const childModule = join(testDir, 'child.js');
      writeFileSync(childModule, "module.exports = 'child';", 'utf-8');

      const parentModule = join(testDir, 'parent.js');
      writeFileSync(
        parentModule,
        `
const child = require('./child');
module.exports = 'parent: ' + child;
`,
        'utf-8',
      );

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const parent = require('./parent');
console.log(parent);
`,
        'utf-8',
      );

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Check that graph modules exist
      expect(result.graph).toBeDefined();
      expect(result.graph!.has(childModule)).toBe(true);
      expect(result.graph!.has(parentModule)).toBe(true);
      expect(result.graph!.has(entryFile)).toBe(true);

      // Check inverse dependencies are built
      // child.js should have parent.js as inverse dependency
      const childGraphModule = result.graph!.get(childModule);
      expect(childGraphModule).toBeDefined();
      expect(childGraphModule!.inverseDependencies).toBeDefined();
      expect(childGraphModule!.inverseDependencies).toContain(parentModule);

      // parent.js should have index.js as inverse dependency
      const parentGraphModule = result.graph!.get(parentModule);
      expect(parentGraphModule).toBeDefined();
      expect(parentGraphModule!.inverseDependencies).toBeDefined();
      expect(parentGraphModule!.inverseDependencies).toContain(entryFile);
    });
  });

  describe('Module export patterns for React Refresh', () => {
    test('should transform default export correctly for React Refresh boundary detection', async () => {
      // Create mock react
      const reactDir = join(testDir, 'node_modules', 'react');
      mkdirSync(reactDir, { recursive: true });
      writeFileSync(
        join(reactDir, 'package.json'),
        JSON.stringify({ name: 'react', main: 'index.js' }),
      );
      writeFileSync(join(reactDir, 'index.js'), 'module.exports = { createElement: () => {} };');
      writeFileSync(
        join(reactDir, 'jsx-runtime.js'),
        'module.exports = { jsx: () => {}, jsxs: () => {} };',
      );

      const componentFile = join(testDir, 'App.jsx');
      writeFileSync(
        componentFile,
        `
import React from 'react';

function App() {
  return <div>Hello</div>;
}

export default App;
`,
        'utf-8',
      );

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
import App from './App';
console.log(App);
`,
        'utf-8',
      );

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // The bundle should contain exports.default = App pattern
      // This is required for React Refresh to detect the component as a boundary
      expect(result.code).toContain('exports.default');
    });

    test('should transform named exports correctly', async () => {
      const utilsFile = join(testDir, 'utils.js');
      writeFileSync(
        utilsFile,
        `
export function greet(name) {
  return 'Hello ' + name;
}

export const VERSION = '1.0.0';
`,
        'utf-8',
      );

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
import { greet, VERSION } from './utils';
console.log(greet('World'), VERSION);
`,
        'utf-8',
      );

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Named exports should be on exports object
      expect(result.code).toContain('exports.greet');
      expect(result.code).toContain('exports.VERSION');
    });
  });
});

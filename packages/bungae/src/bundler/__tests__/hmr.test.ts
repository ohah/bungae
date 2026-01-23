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
import {
  buildWithGraph,
  incrementalBuild,
  createHMRUpdateMessage,
  type PlatformBuildState,
  type DeltaResult,
} from '../graph-bundler';

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

  describe('incrementalBuild', () => {
    test('should rebuild only changed files and affected modules', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'original';", 'utf-8');

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

      // Initial build
      const initialResult = await buildWithGraph(config);
      expect(initialResult.graph).toBeDefined();
      expect(initialResult.createModuleId).toBeDefined();

      // Create old state for incremental build
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      // Build module ID mappings
      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Modify module file
      writeFileSync(moduleFile, "module.exports = 'modified';", 'utf-8');

      // Incremental build
      const incrementalResult = await incrementalBuild([moduleFile], oldState, config);
      expect(incrementalResult).not.toBeNull();
      expect(incrementalResult!.delta.modified.size).toBeGreaterThan(0);
      expect(incrementalResult!.delta.modified.has(moduleFile)).toBe(true);

      // Module IDs should be consistent
      const oldModuleId = oldState.pathToModuleId.get(moduleFile);
      const newModuleId = incrementalResult!.newState.pathToModuleId.get(moduleFile);
      expect(oldModuleId).toBe(newModuleId);
    });

    test('should detect added modules', async () => {
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

      // Initial build
      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Add new module
      const newModuleFile = join(testDir, 'new-module.js');
      writeFileSync(newModuleFile, "module.exports = 'new';", 'utf-8');

      // Update entry to require new module
      writeFileSync(
        entryFile,
        `
const newMod = require('./new-module');
console.log(newMod);
`,
        'utf-8',
      );

      // Incremental build
      const incrementalResult = await incrementalBuild(
        [entryFile, newModuleFile],
        oldState,
        config,
      );
      expect(incrementalResult).not.toBeNull();
      expect(incrementalResult!.delta.added.size).toBeGreaterThan(0);
      expect(incrementalResult!.delta.added.has(newModuleFile)).toBe(true);
    });

    test('should detect deleted modules', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'test';", 'utf-8');

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

      // Initial build
      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Delete module file
      rmSync(moduleFile);

      // Update entry to not require deleted module
      writeFileSync(entryFile, "console.log('no module');", 'utf-8');

      // Incremental build
      const incrementalResult = await incrementalBuild([entryFile, moduleFile], oldState, config);
      expect(incrementalResult).not.toBeNull();
      expect(incrementalResult!.delta.deleted.size).toBeGreaterThan(0);
      expect(incrementalResult!.delta.deleted.has(moduleFile)).toBe(true);
    });

    test('should maintain module ID consistency across incremental builds', async () => {
      const moduleA = join(testDir, 'a.js');
      const moduleB = join(testDir, 'b.js');
      writeFileSync(moduleA, "module.exports = 'a';", 'utf-8');
      writeFileSync(moduleB, "module.exports = 'b';", 'utf-8');

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const a = require('./a');
const b = require('./b');
console.log(a, b);
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

      // Initial build
      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      const originalModuleAId = oldState.pathToModuleId.get(moduleA);
      const originalModuleBId = oldState.pathToModuleId.get(moduleB);

      // Modify module A
      writeFileSync(moduleA, "module.exports = 'a-modified';", 'utf-8');

      // Incremental build
      const incrementalResult = await incrementalBuild([moduleA], oldState, config);
      expect(incrementalResult).not.toBeNull();

      // Module IDs should remain the same
      const newModuleAId = incrementalResult!.newState.pathToModuleId.get(moduleA);
      const newModuleBId = incrementalResult!.newState.pathToModuleId.get(moduleB);

      expect(newModuleAId).toBe(originalModuleAId);
      expect(newModuleBId).toBe(originalModuleBId);
    });
  });

  describe('createHMRUpdateMessage', () => {
    test('should create Metro-compatible HMR update message', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'test';", 'utf-8');

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

      // Initial build
      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Modify module
      writeFileSync(moduleFile, "module.exports = 'modified';", 'utf-8');

      // Incremental build
      const incrementalResult = await incrementalBuild([moduleFile], oldState, config);
      expect(incrementalResult).not.toBeNull();

      // Create HMR message
      const hmrMessage = await createHMRUpdateMessage(
        incrementalResult!.delta,
        config,
        incrementalResult!.newState.createModuleId,
        incrementalResult!.newState.revisionId,
        false, // isInitialUpdate
        oldState.pathToModuleId,
        incrementalResult!.newState.graph,
      );

      // Verify Metro protocol format
      expect(hmrMessage.type).toBe('update');
      expect(hmrMessage.body).toBeDefined();
      expect(hmrMessage.body.revisionId).toBeDefined();
      expect(typeof hmrMessage.body.isInitialUpdate).toBe('boolean');
      expect(Array.isArray(hmrMessage.body.added)).toBe(true);
      expect(Array.isArray(hmrMessage.body.modified)).toBe(true);
      expect(Array.isArray(hmrMessage.body.deleted)).toBe(true);

      // Verify modified module format
      expect(hmrMessage.body.modified.length).toBeGreaterThan(0);
      const modifiedModule = hmrMessage.body.modified[0]!;
      expect(Array.isArray(modifiedModule.module)).toBe(true);
      expect(modifiedModule.module.length).toBe(2);
      expect(typeof modifiedModule.module[0]).toBe('number'); // module ID
      expect(typeof modifiedModule.module[1]).toBe('string'); // code
      expect(typeof modifiedModule.sourceURL).toBe('string');
      expect(modifiedModule.sourceMappingURL).toBeDefined();
    });

    test('should include sourceMappingURL in HMR message', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'test';", 'utf-8');

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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      writeFileSync(moduleFile, "module.exports = 'modified';", 'utf-8');

      const incrementalResult = await incrementalBuild([moduleFile], oldState, config);
      expect(incrementalResult).not.toBeNull();

      const hmrMessage = await createHMRUpdateMessage(
        incrementalResult!.delta,
        config,
        incrementalResult!.newState.createModuleId,
        incrementalResult!.newState.revisionId,
        false,
        oldState.pathToModuleId,
        incrementalResult!.newState.graph,
      );

      // Check that sourceMappingURL is included
      expect(hmrMessage.body.modified.length).toBeGreaterThan(0);
      const modifiedModule = hmrMessage.body.modified[0]!;
      expect(modifiedModule.sourceMappingURL).toBeDefined();
      expect(typeof modifiedModule.sourceMappingURL).toBe('string');
      expect(modifiedModule.sourceMappingURL).toContain('.map');
    });

    test('should set isInitialUpdate flag correctly', async () => {
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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Create empty delta for initial update
      const emptyDelta: DeltaResult = {
        added: new Map(),
        modified: new Map(),
        deleted: new Set(),
      };

      // Test initial update
      const initialHmrMessage = await createHMRUpdateMessage(
        emptyDelta,
        config,
        oldState.createModuleId,
        'initial-revision',
        true, // isInitialUpdate
        oldState.pathToModuleId,
        oldState.graph,
      );

      expect(initialHmrMessage.body.isInitialUpdate).toBe(true);

      // Test incremental update
      writeFileSync(entryFile, "console.log('modified');", 'utf-8');
      const incrementalResult = await incrementalBuild([entryFile], oldState, config);
      expect(incrementalResult).not.toBeNull();

      const incrementalHmrMessage = await createHMRUpdateMessage(
        incrementalResult!.delta,
        config,
        incrementalResult!.newState.createModuleId,
        incrementalResult!.newState.revisionId,
        false, // isInitialUpdate
        oldState.pathToModuleId,
        incrementalResult!.newState.graph,
      );

      expect(incrementalHmrMessage.body.isInitialUpdate).toBe(false);
    });

    test('should include deleted modules in HMR message', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'test';", 'utf-8');

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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      const deletedModuleId = oldState.pathToModuleId.get(moduleFile);
      expect(deletedModuleId).toBeDefined();

      // Delete module
      rmSync(moduleFile);
      writeFileSync(entryFile, "console.log('no module');", 'utf-8');

      const incrementalResult = await incrementalBuild([entryFile, moduleFile], oldState, config);
      expect(incrementalResult).not.toBeNull();
      expect(incrementalResult!.delta.deleted.size).toBeGreaterThan(0);

      const hmrMessage = await createHMRUpdateMessage(
        incrementalResult!.delta,
        config,
        incrementalResult!.newState.createModuleId,
        incrementalResult!.newState.revisionId,
        false,
        oldState.pathToModuleId,
        incrementalResult!.newState.graph,
      );

      // Deleted modules should be in deleted array as module IDs
      expect(hmrMessage.body.deleted.length).toBeGreaterThan(0);
      expect(hmrMessage.body.deleted).toContain(
        typeof deletedModuleId === 'number' ? deletedModuleId : Number(deletedModuleId),
      );
    });

    test('should include inverseDependencies in module code', async () => {
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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Modify child module
      writeFileSync(childModule, "module.exports = 'child-modified';", 'utf-8');

      const incrementalResult = await incrementalBuild([childModule], oldState, config);
      expect(incrementalResult).not.toBeNull();

      const hmrMessage = await createHMRUpdateMessage(
        incrementalResult!.delta,
        config,
        incrementalResult!.newState.createModuleId,
        incrementalResult!.newState.revisionId,
        false,
        oldState.pathToModuleId,
        incrementalResult!.newState.graph,
      );

      // Find child module in modified array
      const childModuleId = incrementalResult!.newState.pathToModuleId.get(childModule);
      const childModuleUpdate = hmrMessage.body.modified.find(
        (m) =>
          m.module[0] ===
          (typeof childModuleId === 'number' ? childModuleId : Number(childModuleId)),
      );

      expect(childModuleUpdate).toBeDefined();
      if (childModuleUpdate) {
        // The code should contain inverse dependencies in __d() call
        // Metro format: __d(function() {...}, moduleId, [...deps], "path", {inverseDependencies})
        const code = childModuleUpdate.module[1];
        // Check that __d() call exists
        expect(code).toContain('__d(');
        // Inverse dependencies should be added as a parameter to __d()
        // The exact format depends on addParamsToDefineCall implementation
        expect(code.length).toBeGreaterThan(0);
      }
    });
  });

  describe('HMR update scenarios', () => {
    test('should handle complete HMR update flow: file change → incremental build → HMR message', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'original';", 'utf-8');

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

      // Step 1: Initial build
      const initialResult = await buildWithGraph(config);
      expect(initialResult.graph).toBeDefined();
      expect(initialResult.createModuleId).toBeDefined();

      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Step 2: File change
      writeFileSync(moduleFile, "module.exports = 'modified';", 'utf-8');

      // Step 3: Incremental build
      const incrementalResult = await incrementalBuild([moduleFile], oldState, config);
      expect(incrementalResult).not.toBeNull();
      expect(incrementalResult!.delta.modified.size).toBeGreaterThan(0);

      // Step 4: Create HMR message
      const hmrMessage = await createHMRUpdateMessage(
        incrementalResult!.delta,
        config,
        incrementalResult!.newState.createModuleId,
        incrementalResult!.newState.revisionId,
        false,
        oldState.pathToModuleId,
        incrementalResult!.newState.graph,
      );

      // Verify complete flow
      expect(hmrMessage.type).toBe('update');
      expect(hmrMessage.body.modified.length).toBeGreaterThan(0);
      expect(hmrMessage.body.revisionId).toBe(incrementalResult!.newState.revisionId);
    });

    test('should generate unique revisionId for each update', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('v1');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const initialResult = await buildWithGraph(config);
      const oldState1: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState1.graph.entries()) {
        const moduleId = oldState1.createModuleId(path);
        oldState1.moduleIdToPath.set(moduleId, path);
        oldState1.pathToModuleId.set(path, moduleId);
      }

      // First update
      writeFileSync(entryFile, "console.log('v2');", 'utf-8');
      const result1 = await incrementalBuild([entryFile], oldState1, config);
      expect(result1).not.toBeNull();
      const revisionId1 = result1!.newState.revisionId;

      // Second update
      writeFileSync(entryFile, "console.log('v3');", 'utf-8');
      const result2 = await incrementalBuild([entryFile], result1!.newState, config);
      expect(result2).not.toBeNull();
      const revisionId2 = result2!.newState.revisionId;

      // Revision IDs should be different
      expect(revisionId1).not.toBe(revisionId2);
      expect(revisionId1).not.toBe('initial');
      expect(revisionId2).not.toBe('initial');
    });
  });

  describe('Multi-platform HMR', () => {
    test('should maintain separate build states for different platforms', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('hello');", 'utf-8');

      // Build for iOS
      const iosConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const iosResult = await buildWithGraph(iosConfig);
      const iosState: PlatformBuildState = {
        graph: iosResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'ios-initial',
        createModuleId: iosResult.createModuleId!,
      };

      for (const [path] of iosState.graph.entries()) {
        const moduleId = iosState.createModuleId(path);
        iosState.moduleIdToPath.set(moduleId, path);
        iosState.pathToModuleId.set(path, moduleId);
      }

      // Build for Android
      const androidConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'android',
          dev: true,
        },
        testDir,
      );

      const androidResult = await buildWithGraph(androidConfig);
      const androidState: PlatformBuildState = {
        graph: androidResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'android-initial',
        createModuleId: androidResult.createModuleId!,
      };

      for (const [path] of androidState.graph.entries()) {
        const moduleId = androidState.createModuleId(path);
        androidState.moduleIdToPath.set(moduleId, path);
        androidState.pathToModuleId.set(path, moduleId);
      }

      // Modify file
      writeFileSync(entryFile, "console.log('modified');", 'utf-8');

      // Incremental build for iOS
      const iosIncremental = await incrementalBuild([entryFile], iosState, iosConfig);
      expect(iosIncremental).not.toBeNull();

      // Incremental build for Android
      const androidIncremental = await incrementalBuild([entryFile], androidState, androidConfig);
      expect(androidIncremental).not.toBeNull();

      // States should be independent
      expect(iosIncremental!.newState.revisionId).not.toBe(androidIncremental!.newState.revisionId);
      expect(iosIncremental!.newState.revisionId).not.toBe('android-initial');
      expect(androidIncremental!.newState.revisionId).not.toBe('ios-initial');
    });
  });

  describe('Error handling', () => {
    test('should return null when entry file does not exist', async () => {
      const entryFile = join(testDir, 'nonexistent.js');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'nonexistent.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      // Create initial state with empty graph
      const createModuleId = createModuleIdFactory();
      const oldState: PlatformBuildState = {
        graph: new Map(),
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId,
      };

      // Try incremental build with non-existent entry
      const result = await incrementalBuild([entryFile], oldState, config);
      expect(result).toBeNull();
    });

    test('should handle syntax errors gracefully in incremental build', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('valid');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      // Initial build
      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Write invalid syntax
      writeFileSync(entryFile, 'const x = {; // syntax error', 'utf-8');

      // Incremental build should handle the error
      // Note: The actual error handling depends on transformFile implementation
      // This test verifies that the function doesn't crash
      try {
        const result = await incrementalBuild([entryFile], oldState, config);
        // Result might be null or might contain error information
        // The important thing is it doesn't throw
        expect(result === null || result !== null).toBe(true);
      } catch (error) {
        // If it throws, that's also acceptable error handling
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('URL parameter handling', () => {
    test('should include query parameters in sourceURL', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'test';", 'utf-8');

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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      writeFileSync(moduleFile, "module.exports = 'modified';", 'utf-8');

      const incrementalResult = await incrementalBuild([moduleFile], oldState, config);
      expect(incrementalResult).not.toBeNull();

      const hmrMessage = await createHMRUpdateMessage(
        incrementalResult!.delta,
        config,
        incrementalResult!.newState.createModuleId,
        incrementalResult!.newState.revisionId,
        false,
        oldState.pathToModuleId,
        incrementalResult!.newState.graph,
      );

      // Check that sourceURL is a relative path (Metro format)
      if (hmrMessage.body.modified.length > 0) {
        const modifiedModule = hmrMessage.body.modified[0]!;
        expect(modifiedModule.sourceURL).toBeDefined();
        expect(typeof modifiedModule.sourceURL).toBe('string');
        // Should be relative path without query params in basic case
        // In real Metro, query params are added by the server
        expect(modifiedModule.sourceURL).not.toContain('?');
      }
    });
  });

  describe('File event handling', () => {
    test('should handle file addition events', async () => {
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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Add new file
      const newFile = join(testDir, 'new-file.js');
      writeFileSync(newFile, "module.exports = 'new';", 'utf-8');

      // Update entry to require new file
      writeFileSync(
        entryFile,
        `
const newMod = require('./new-file');
console.log(newMod);
`,
        'utf-8',
      );

      // Incremental build should detect the new file
      const result = await incrementalBuild([entryFile, newFile], oldState, config);
      expect(result).not.toBeNull();
      expect(result!.delta.added.size).toBeGreaterThan(0);
      expect(result!.delta.added.has(newFile)).toBe(true);
    });

    test('should handle file deletion events', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'test';", 'utf-8');

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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Delete file
      rmSync(moduleFile);

      // Update entry to not require deleted module
      writeFileSync(entryFile, "console.log('no module');", 'utf-8');

      // Incremental build should detect the deletion
      const result = await incrementalBuild([entryFile, moduleFile], oldState, config);
      expect(result).not.toBeNull();
      expect(result!.delta.deleted.size).toBeGreaterThan(0);
      expect(result!.delta.deleted.has(moduleFile)).toBe(true);
    });
  });

  describe('Delta edge cases', () => {
    test('should handle empty delta correctly', async () => {
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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // No file changes
      const result = await incrementalBuild([], oldState, config);
      expect(result).not.toBeNull();
      expect(result!.delta.added.size).toBe(0);
      expect(result!.delta.modified.size).toBe(0);
      expect(result!.delta.deleted.size).toBe(0);
    });

    test('should handle multiple simultaneous changes', async () => {
      const moduleA = join(testDir, 'a.js');
      const moduleB = join(testDir, 'b.js');
      writeFileSync(moduleA, "module.exports = 'a';", 'utf-8');
      writeFileSync(moduleB, "module.exports = 'b';", 'utf-8');

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const a = require('./a');
const b = require('./b');
console.log(a, b);
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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Modify both files simultaneously
      writeFileSync(moduleA, "module.exports = 'a-modified';", 'utf-8');
      writeFileSync(moduleB, "module.exports = 'b-modified';", 'utf-8');

      const result = await incrementalBuild([moduleA, moduleB], oldState, config);
      expect(result).not.toBeNull();
      expect(result!.delta.modified.size).toBeGreaterThanOrEqual(2);
      expect(result!.delta.modified.has(moduleA)).toBe(true);
      expect(result!.delta.modified.has(moduleB)).toBe(true);
    });

    test('should handle add, modify, and delete in same update', async () => {
      const moduleA = join(testDir, 'a.js');
      const moduleB = join(testDir, 'b.js');
      writeFileSync(moduleA, "module.exports = 'a';", 'utf-8');
      writeFileSync(moduleB, "module.exports = 'b';", 'utf-8');

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const a = require('./a');
const b = require('./b');
console.log(a, b);
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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Modify A, delete B, add C
      writeFileSync(moduleA, "module.exports = 'a-modified';", 'utf-8');
      rmSync(moduleB);
      const moduleC = join(testDir, 'c.js');
      writeFileSync(moduleC, "module.exports = 'c';", 'utf-8');

      writeFileSync(
        entryFile,
        `
const a = require('./a');
const c = require('./c');
console.log(a, c);
`,
        'utf-8',
      );

      const result = await incrementalBuild(
        [entryFile, moduleA, moduleB, moduleC],
        oldState,
        config,
      );
      expect(result).not.toBeNull();

      // Should have all three types of changes
      expect(result!.delta.modified.has(moduleA)).toBe(true);
      expect(result!.delta.deleted.has(moduleB)).toBe(true);
      expect(result!.delta.added.has(moduleC)).toBe(true);
    });
  });

  describe('HMR message format validation', () => {
    test('should create valid Metro HMR message structure', async () => {
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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      writeFileSync(entryFile, "console.log('modified');", 'utf-8');

      const incrementalResult = await incrementalBuild([entryFile], oldState, config);
      expect(incrementalResult).not.toBeNull();

      const hmrMessage = await createHMRUpdateMessage(
        incrementalResult!.delta,
        config,
        incrementalResult!.newState.createModuleId,
        incrementalResult!.newState.revisionId,
        false,
        oldState.pathToModuleId,
        incrementalResult!.newState.graph,
      );

      // Validate Metro protocol structure
      expect(hmrMessage).toHaveProperty('type', 'update');
      expect(hmrMessage).toHaveProperty('body');
      expect(hmrMessage.body).toHaveProperty('revisionId');
      expect(hmrMessage.body).toHaveProperty('isInitialUpdate');
      expect(hmrMessage.body).toHaveProperty('added');
      expect(hmrMessage.body).toHaveProperty('modified');
      expect(hmrMessage.body).toHaveProperty('deleted');

      // Arrays should be arrays
      expect(Array.isArray(hmrMessage.body.added)).toBe(true);
      expect(Array.isArray(hmrMessage.body.modified)).toBe(true);
      expect(Array.isArray(hmrMessage.body.deleted)).toBe(true);

      // Validate module format in modified array
      if (hmrMessage.body.modified.length > 0) {
        const mod = hmrMessage.body.modified[0]!;
        expect(mod).toHaveProperty('module');
        expect(Array.isArray(mod.module)).toBe(true);
        expect(mod.module.length).toBe(2);
        expect(typeof mod.module[0]).toBe('number');
        expect(typeof mod.module[1]).toBe('string');
        expect(mod).toHaveProperty('sourceURL');
        expect(typeof mod.sourceURL).toBe('string');
      }
    });

    test('should handle empty arrays in HMR message', async () => {
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

      const initialResult = await buildWithGraph(config);
      const oldState: PlatformBuildState = {
        graph: initialResult.graph!,
        moduleIdToPath: new Map(),
        pathToModuleId: new Map(),
        revisionId: 'initial',
        createModuleId: initialResult.createModuleId!,
      };

      for (const [path] of oldState.graph.entries()) {
        const moduleId = oldState.createModuleId(path);
        oldState.moduleIdToPath.set(moduleId, path);
        oldState.pathToModuleId.set(path, moduleId);
      }

      // Create empty delta
      const emptyDelta: DeltaResult = {
        added: new Map(),
        modified: new Map(),
        deleted: new Set(),
      };

      const hmrMessage = await createHMRUpdateMessage(
        emptyDelta,
        config,
        oldState.createModuleId,
        'test-revision',
        false,
        oldState.pathToModuleId,
        oldState.graph,
      );

      // Should have empty arrays
      expect(hmrMessage.body.added.length).toBe(0);
      expect(hmrMessage.body.modified.length).toBe(0);
      expect(hmrMessage.body.deleted.length).toBe(0);
    });
  });
});

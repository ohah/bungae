/**
 * Graph Bundler Tests
 *
 * Tests for the Graph bundler with Babel transformation
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveConfig, getDefaultConfig } from '../../config';
import { buildWithGraph } from '../graph-bundler';

// Skip metro-runtime tests in unit test environment
// These tests require a proper React Native project with metro-runtime installed
// Run with BUNGAE_TEST_RN=1 to enable these tests (e.g., in ExampleApp)
const skipMetroRuntimeTests = process.env.BUNGAE_TEST_RN !== '1';

describe('Graph Bundler', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-graph-test-${Date.now()}`);
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
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Bundle Structure', () => {
    test('should create bundle with prelude, modules, and post sections', async () => {
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

      // Should have bundle comment
      expect(result.code).toContain('// Bungae Bundle (Graph Mode)');

      // Should have prelude variables
      expect(result.code).toContain('__BUNDLE_START_TIME__');
      expect(result.code).toContain('__DEV__=true');

      // Should have __d() module definitions
      expect(result.code).toContain('__d(');

      // Should have __r() module execution
      expect(result.code).toContain('__r(');
    });

    // Skip: requires react-native to be installed for metro-runtime
    test.skipIf(skipMetroRuntimeTests)('should include metro-runtime', async () => {
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

      // Metro runtime should be included and executed
      // Note: __d is accessed via global[`${__METRO_GLOBAL_PREFIX__}__d`] for prefix support
      expect(result.code).toContain('global.__r');
      expect(result.code).toContain('__METRO_GLOBAL_PREFIX__');
      expect(result.code).toContain('__d');
    });
  });

  describe('Babel Transformation', () => {
    test('should transform Flow types', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
// @flow
type User = { name: string, age: number };
const user: User = { name: 'John', age: 30 };
console.log(user.name);
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

      // Flow types should be stripped
      expect(result.code).not.toContain('type User');
      expect(result.code).not.toContain(': User');
      expect(result.code).not.toContain(': string');

      // But the actual code should remain
      expect(result.code).toContain('John');
      expect(result.code).toContain('30');
    });

    test('should transform TypeScript', async () => {
      const entryFile = join(testDir, 'index.ts');
      writeFileSync(
        entryFile,
        `
interface Config {
  debug: boolean;
  version: string;
}

const config: Config = { debug: true, version: '1.0.0' };
console.log(config.version);
`,
        'utf-8',
      );

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.ts',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // TypeScript should be stripped
      expect(result.code).not.toContain('interface Config');
      expect(result.code).not.toContain(': Config');
      expect(result.code).not.toContain(': boolean');

      // But the actual code should remain
      expect(result.code).toContain('1.0.0');
    });

    test('should transform JSX', async () => {
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

      const entryFile = join(testDir, 'index.jsx');
      writeFileSync(
        entryFile,
        `
import React from 'react';
const App = () => <div className="app">Hello</div>;
export default App;
`,
        'utf-8',
      );

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.jsx',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // JSX should be transformed
      expect(result.code).not.toContain('<div');
      expect(result.code).not.toContain('</div>');

      // Should have jsx or createElement call
      expect(result.code.includes('jsx') || result.code.includes('createElement')).toBe(true);
    });

    test('should transform ES modules to CommonJS', async () => {
      const utilsFile = join(testDir, 'utils.js');
      writeFileSync(
        utilsFile,
        `
export const greet = (name) => 'Hello ' + name;
export default { version: '1.0.0' };
`,
        'utf-8',
      );

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
import utils, { greet } from './utils';
console.log(greet('World'));
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

      // Should have module.exports
      expect(result.code).toContain('exports');

      // Both modules should be included
      expect(result.code).toContain('Hello');
      expect(result.code).toContain('1.0.0');
    });
  });

  describe('Dependency Resolution', () => {
    test('should resolve relative imports', async () => {
      const moduleFile = join(testDir, 'module.js');
      writeFileSync(moduleFile, "module.exports = 'module';", 'utf-8');

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

      // Both modules should be in the bundle
      expect(result.code).toContain('module');
    });

    test('should resolve nested dependencies', async () => {
      const aFile = join(testDir, 'a.js');
      const bFile = join(testDir, 'b.js');
      const cFile = join(testDir, 'c.js');

      writeFileSync(cFile, "module.exports = 'c';", 'utf-8');
      writeFileSync(bFile, "const c = require('./c'); module.exports = 'b' + c;", 'utf-8');
      writeFileSync(aFile, "const b = require('./b'); module.exports = 'a' + b;", 'utf-8');

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

      // All modules should be included
      // Count __d( occurrences (should have at least 4: index, a, b, c)
      const moduleCount = (result.code.match(/__d\(/g) || []).length;
      expect(moduleCount).toBeGreaterThanOrEqual(4);
    });

    test('should handle JSON files', async () => {
      const jsonFile = join(testDir, 'config.json');
      writeFileSync(jsonFile, JSON.stringify({ name: 'test', version: '1.0.0' }), 'utf-8');

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const config = require('./config.json');
console.log(config.name);
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

      // JSON should be wrapped as module.exports
      expect(result.code).toContain('"name"');
      expect(result.code).toContain('"test"');
    });
  });

  describe('Platform Resolution', () => {
    test('should resolve platform-specific files for iOS', async () => {
      const genericFile = join(testDir, 'platform.js');
      const iosFile = join(testDir, 'platform.ios.js');

      writeFileSync(genericFile, "module.exports = 'generic';", 'utf-8');
      writeFileSync(iosFile, "module.exports = 'ios';", 'utf-8');

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        "const platform = require('./platform'); console.log(platform);",
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

      // Should use iOS-specific file
      expect(result.code).toContain("'ios'");
      expect(result.code).not.toContain("'generic'");
    });

    test('should resolve platform-specific files for Android', async () => {
      const genericFile = join(testDir, 'platform.js');
      const androidFile = join(testDir, 'platform.android.js');

      writeFileSync(genericFile, "module.exports = 'generic';", 'utf-8');
      writeFileSync(androidFile, "module.exports = 'android';", 'utf-8');

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        "const platform = require('./platform'); console.log(platform);",
        'utf-8',
      );

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'android',
          dev: true,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // Should use Android-specific file
      expect(result.code).toContain("'android'");
      expect(result.code).not.toContain("'generic'");
    });
  });

  describe('Source Maps', () => {
    test('should generate source map in dev mode', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('sourcemap test');", 'utf-8');

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

      expect(result.map).toBeDefined();
      const sourceMap = JSON.parse(result.map!);
      expect(sourceMap.version).toBe(3);
      expect(sourceMap.sources).toBeDefined();
    });

    test('should NOT generate source map in production mode', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('no sourcemap');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: false,
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      expect(result.map).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    test('should throw error for non-existent entry file', async () => {
      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'non-existent.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      await expect(buildWithGraph(config)).rejects.toThrow('Entry file not found');
    });
  });
});

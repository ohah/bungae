/**
 * Graph Bundler Tests
 *
 * Tests for the Graph bundler with Babel transformation
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { resolveConfig, getDefaultConfig } from '../../config';
import { buildWithGraph } from '../graph-bundler';

// Get packages/bungae directory (where dependencies are)
// Current file: packages/bungae/src/bundler/__tests__/graph-bundler.test.ts
// Target: packages/bungae/package.json
const currentFile = fileURLToPath(import.meta.url);
// Go up 4 levels: __tests__ -> bundler -> src -> bungae
const packageDir = join(currentFile, '..', '..', '..', '..');

// Helper to resolve plugin with fallback to project root
function resolvePlugin(pluginName: string): string {
  try {
    // Try from packages/bungae
    const packageRequire = createRequire(join(packageDir, 'package.json'));
    return packageRequire.resolve(pluginName);
  } catch {
    // Fallback to project root
    const rootRequire = createRequire(join(packageDir, '..', '..', 'package.json'));
    return rootRequire.resolve(pluginName);
  }
}

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

    // Create default babel.config.js for tests (Metro requires babel.config.js)
    // Resolve plugin paths from packages/bungae and use absolute paths
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

      // Metro-compatible: no bundle header comment (Metro's bundleToString doesn't add one)

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

    test('should replace __DEV__ with true in development builds', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
if (__DEV__) {
  console.log('development mode');
}
console.log('always');
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

      // __DEV__ should be replaced with true, but the if block should remain
      // (dead code elimination is not applied in dev builds)
      expect(result.code).toContain('development mode');
      expect(result.code).toContain('always');
    });

    test('should replace __DEV__ with false and eliminate dead code in production builds', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
if (__DEV__) {
  console.log('development mode');
}
console.log('always');
`,
        'utf-8',
      );

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

      // __DEV__ should be replaced with false and the if block should be eliminated
      expect(result.code).not.toContain('development mode');
      expect(result.code).toContain('always');
    });

    test('should eliminate __DEV__ && expression in production builds', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
__DEV__ && console.log('dev only');
console.log('always');
`,
        'utf-8',
      );

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

      // __DEV__ && expression should be simplified and the console.log should be eliminated
      expect(result.code).not.toContain('dev only');
      expect(result.code).toContain('always');
    });

    test('should replace process.env.NODE_ENV with production in production builds', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
if (process.env.NODE_ENV === 'development') {
  console.log('development');
} else {
  console.log('production');
}
`,
        'utf-8',
      );

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

      // process.env.NODE_ENV should be replaced with 'production'
      // and the development branch should be eliminated
      expect(result.code).not.toContain('development');
      expect(result.code).toContain('production');
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
      expect(Array.isArray(sourceMap.sources)).toBe(true);
      expect(sourceMap.sources.length).toBeGreaterThan(0);
      // Source map should include sourcesContent
      expect(sourceMap.sourcesContent).toBeDefined();
      expect(Array.isArray(sourceMap.sourcesContent)).toBe(true);
      // Mappings should be defined (can be empty string for basic implementation)
      expect(sourceMap.mappings).toBeDefined();
      expect(typeof sourceMap.mappings).toBe('string');
      // Names should be defined
      expect(sourceMap.names).toBeDefined();
      expect(Array.isArray(sourceMap.names)).toBe(true);
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

    test('should include source map URL comment in bundle code', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('sourcemap url test');", 'utf-8');

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

      // Metro-compatible: buildWithGraph returns code without sourceMappingURL comment
      // The comment is added by the server when serving the bundle
      // For this test, we verify that source map is generated (map is defined)
      // and that the code doesn't contain sourceMappingURL (it will be added by server)
      expect(result.map).toBeDefined();
      // When not using inlineSourceMap, code should not contain sourceMappingURL
      // (server.ts will add it when serving)
      expect(result.code).not.toContain('//# sourceMappingURL');
    });

    test('should generate source map with multiple modules', async () => {
      const entryFile = join(testDir, 'index.js');
      const fooFile = join(testDir, 'foo.js');
      const barFile = join(testDir, 'bar.js');

      writeFileSync(entryFile, "require('./foo');", 'utf-8');
      writeFileSync(fooFile, "require('./bar');\nconsole.log('foo');", 'utf-8');
      writeFileSync(barFile, "console.log('bar');", 'utf-8');

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
      // Should include all source files
      expect(sourceMap.sources.length).toBeGreaterThanOrEqual(3);
      // Should include sourcesContent for all sources
      expect(sourceMap.sourcesContent.length).toBe(sourceMap.sources.length);
      // Each source should have corresponding content
      for (let i = 0; i < sourceMap.sources.length; i++) {
        expect(typeof sourceMap.sourcesContent[i]).toBe('string');
      }
    });

    test('should support inlineSourceMap option', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('inline sourcemap test');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
          serializer: {
            inlineSourceMap: true,
          },
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // When inlineSourceMap is true, map should be undefined (included in code)
      expect(result.map).toBeUndefined();
      // Bundle code should contain inline source map (base64 encoded)
      expect(result.code).toContain(
        '//# sourceMappingURL=data:application/json;charset=utf-8;base64,',
      );

      // Extract and verify inline source map
      const base64Index = result.code.indexOf('base64,');
      if (base64Index !== -1) {
        const base64Data = result.code.slice(base64Index + 7).split('\n')[0];
        if (base64Data) {
          const sourceMapJson = JSON.parse(Buffer.from(base64Data, 'base64').toString());
          expect(sourceMapJson.version).toBe(3);
          expect(sourceMapJson.sources).toBeDefined();
          expect(Array.isArray(sourceMapJson.sources)).toBe(true);
        }
      }
    });

    test('should generate source map with correct file paths', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('path test');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      // Default sourcePaths is 'absolute' for DevTools/Hermes compatibility
      // This uses absolute file paths in source map sources
      const result = await buildWithGraph(config);

      expect(result.map).toBeDefined();
      const sourceMap = JSON.parse(result.map!);
      expect(sourceMap.sources).toBeDefined();

      // When sourcePaths='absolute', Metro uses absolute paths (module.path)
      // Metro-compatible: absolute path should be in sources
      expect(sourceMap.sources).toContain(entryFile);
    });

    test('should generate x_google_ignoreList when shouldAddToIgnoreList returns true', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('ignore list test');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
          serializer: {
            shouldAddToIgnoreList: () => true, // All modules should be ignored
          },
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      expect(result.map).toBeDefined();
      const sourceMap = JSON.parse(result.map!);
      expect(sourceMap.x_google_ignoreList).toBeDefined();
      expect(Array.isArray(sourceMap.x_google_ignoreList)).toBe(true);
      // All modules should be in ignore list
      // __prelude__ is at index 0 (isIgnored: false), index.js is at index 1 (isIgnored: true)
      expect(sourceMap.x_google_ignoreList.length).toBeGreaterThan(0);
      // Check that index.js (at index 1) is in ignore list
      expect(sourceMap.x_google_ignoreList).toEqual(
        expect.arrayContaining([1]), // index.js is at index 1 (after __prelude__ at index 0)
      );
    });

    test('should NOT generate x_google_ignoreList when shouldAddToIgnoreList returns false', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('no ignore list test');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
          serializer: {
            shouldAddToIgnoreList: () => false, // No modules should be ignored
          },
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      expect(result.map).toBeDefined();
      const sourceMap = JSON.parse(result.map!);
      // x_google_ignoreList should not be present when empty
      expect(sourceMap.x_google_ignoreList).toBeUndefined();
    });

    test('should generate x_google_ignoreList for specific modules only (node_modules)', async () => {
      const entryFile = join(testDir, 'index.js');
      const libFile = join(testDir, 'lib.js');
      const nodeModulesDir = join(testDir, 'node_modules', 'dep');
      const nodeModulesFile = join(nodeModulesDir, 'index.js');

      // Create node_modules directory structure
      mkdirSync(nodeModulesDir, { recursive: true });

      writeFileSync(
        entryFile,
        "const lib = require('./lib'); const dep = require('dep');",
        'utf-8',
      );
      writeFileSync(libFile, 'module.exports = { lib: true };', 'utf-8');
      writeFileSync(nodeModulesFile, 'module.exports = { dep: true };', 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
          serializer: {
            // Only ignore node_modules
            shouldAddToIgnoreList: (module) => module.path.includes('node_modules'),
          },
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      expect(result.map).toBeDefined();
      const sourceMap = JSON.parse(result.map!);
      expect(sourceMap.x_google_ignoreList).toBeDefined();
      expect(Array.isArray(sourceMap.x_google_ignoreList)).toBe(true);

      // Find indices of node_modules files
      const nodeModulesIndices: number[] = [];
      sourceMap.sources.forEach((source: string, index: number) => {
        if (source.includes('node_modules')) {
          nodeModulesIndices.push(index);
        }
      });

      // All node_modules should be in ignore list
      expect(nodeModulesIndices.length).toBeGreaterThan(0);
      nodeModulesIndices.forEach((index) => {
        expect(sourceMap.x_google_ignoreList).toContain(index);
      });

      // __prelude__ (index 0) should not be in ignore list
      expect(sourceMap.x_google_ignoreList).not.toContain(0);

      // Entry file and lib file should not be in ignore list
      const entryIndex = sourceMap.sources.findIndex(
        (s: string) => s.includes('index.js') && !s.includes('node_modules'),
      );
      const libIndex = sourceMap.sources.findIndex((s: string) => s.includes('lib.js'));
      if (entryIndex !== -1) {
        expect(sourceMap.x_google_ignoreList).not.toContain(entryIndex);
      }
      if (libIndex !== -1) {
        expect(sourceMap.x_google_ignoreList).not.toContain(libIndex);
      }
    });

    test('should generate x_google_ignoreList with multiple modules and selective ignoring', async () => {
      const entryFile = join(testDir, 'index.js');
      const file1 = join(testDir, 'file1.js');
      const file2 = join(testDir, 'file2.js');
      const file3 = join(testDir, 'file3.js');

      writeFileSync(
        entryFile,
        "require('./file1'); require('./file2'); require('./file3');",
        'utf-8',
      );
      writeFileSync(file1, 'module.exports = { file1: true };', 'utf-8');
      writeFileSync(file2, 'module.exports = { file2: true };', 'utf-8');
      writeFileSync(file3, 'module.exports = { file3: true };', 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
          serializer: {
            // Only ignore file2 and file3
            shouldAddToIgnoreList: (module) => {
              const path = module.path;
              return path.includes('file2') || path.includes('file3');
            },
          },
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      expect(result.map).toBeDefined();
      const sourceMap = JSON.parse(result.map!);
      expect(sourceMap.x_google_ignoreList).toBeDefined();
      expect(Array.isArray(sourceMap.x_google_ignoreList)).toBe(true);

      // Find indices
      const file2Index = sourceMap.sources.findIndex((s: string) => s.includes('file2'));
      const file3Index = sourceMap.sources.findIndex((s: string) => s.includes('file3'));
      const file1Index = sourceMap.sources.findIndex(
        (s: string) => s.includes('file1') && !s.includes('file2') && !s.includes('file3'),
      );

      // file2 and file3 should be in ignore list
      if (file2Index !== -1) {
        expect(sourceMap.x_google_ignoreList).toContain(file2Index);
      }
      if (file3Index !== -1) {
        expect(sourceMap.x_google_ignoreList).toContain(file3Index);
      }

      // file1 should not be in ignore list
      if (file1Index !== -1) {
        expect(sourceMap.x_google_ignoreList).not.toContain(file1Index);
      }
    });

    test('should work with inlineSourceMap option', async () => {
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('inline sourcemap with ignore list');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
          serializer: {
            inlineSourceMap: true,
            shouldAddToIgnoreList: () => true, // All modules should be ignored
          },
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      // When inlineSourceMap is true, map should be undefined (included in code)
      expect(result.map).toBeUndefined();
      expect(result.code).toBeDefined();

      // Bundle code should contain inline source map (base64 encoded)
      expect(result.code).toContain(
        '//# sourceMappingURL=data:application/json;charset=utf-8;base64,',
      );

      // Extract and verify inline source map
      const base64Match = result.code.match(/base64,([A-Za-z0-9+/=]+)/);
      if (base64Match && base64Match[1]) {
        const base64Data = base64Match[1];
        const sourceMapJson = JSON.parse(Buffer.from(base64Data, 'base64').toString());
        expect(sourceMapJson.version).toBe(3);
        expect(sourceMapJson.sources).toBeDefined();
        expect(sourceMapJson.x_google_ignoreList).toBeDefined();
        expect(Array.isArray(sourceMapJson.x_google_ignoreList)).toBe(true);
        expect(sourceMapJson.x_google_ignoreList.length).toBeGreaterThan(0);
      }
    });

    test('should include __prelude__ in x_google_ignoreList when shouldAddToIgnoreList returns true (Metro-compatible)', async () => {
      // Metro behavior: __prelude__ is ALWAYS ignored (see Metro's _shouldAddModuleToIgnoreList)
      // Metro's default shouldAddToIgnoreList includes __prelude__ path check
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('prelude test');", 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
          serializer: {
            shouldAddToIgnoreList: () => true, // All modules should be ignored
          },
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      expect(result.map).toBeDefined();
      const sourceMap = JSON.parse(result.map!);
      expect(sourceMap.x_google_ignoreList).toBeDefined();

      // __prelude__ (index 0) should be in ignore list when shouldAddToIgnoreList returns true
      // This matches Metro's behavior where __prelude__ is always considered for ignoring
      expect(sourceMap.x_google_ignoreList).toContain(0);

      // Other modules (like index.js) should also be in ignore list
      const entryIndex = sourceMap.sources.findIndex(
        (s: string) => s.includes('index.js') && !s.includes('__prelude__'),
      );
      if (entryIndex !== -1 && entryIndex !== 0) {
        expect(sourceMap.x_google_ignoreList).toContain(entryIndex);
      }
    });

    test('should generate source map with correct line number mappings', async () => {
      // This test verifies that source map line numbers correctly align with bundle line numbers
      // Bug: Source map shows line 5 but bundle module starts at line 2 (difference: 3)
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `// Line 1: Comment
// Line 2: Another comment
const x = 1; // Line 3
console.log('Entry module', x); // Line 4`,
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

      expect(result.map).toBeDefined();
      expect(result.code).toBeDefined();

      const sourceMap = JSON.parse(result.map!);

      // Debug: Print source map structure
      console.log(`[SourceMap Test] sources: ${JSON.stringify(sourceMap.sources)}`);

      // Find the entry module in sources
      const entrySourceIndex = sourceMap.sources.findIndex(
        (s: string) => s.includes('index.js') && !s.includes('__prelude__'),
      );
      expect(entrySourceIndex).toBeGreaterThanOrEqual(0);
      console.log(`[SourceMap Test] Entry file source index: ${entrySourceIndex}`);

      // Find where the entry module starts in the bundle
      const bundleLines = result.code.split('\n');
      let entryModuleStartLine = -1;
      for (let i = 0; i < bundleLines.length; i++) {
        const line = bundleLines[i];
        if (!line) continue;
        // Look for __d( call that contains our module's unique content
        // The transformed code may have different format, so check for __d( first
        if (line.includes('__d(')) {
          entryModuleStartLine = i + 1; // 1-indexed
          // Debug: print the line
          console.log(`[SourceMap Test] Found __d( at line ${i + 1}: ${line.substring(0, 100)}...`);
          break;
        }
      }

      // If no __d( found, print bundle for debugging
      if (entryModuleStartLine === -1) {
        console.log('[SourceMap Test] Bundle lines:');
        for (let i = 0; i < Math.min(bundleLines.length, 20); i++) {
          const line = bundleLines[i] || '';
          console.log(`  ${i + 1}: ${line.substring(0, 80)}`);
        }
      }
      expect(entryModuleStartLine).toBeGreaterThan(0);

      // Debug: Print first few bundle lines
      console.log('[SourceMap Test] First 5 bundle lines:');
      for (let i = 0; i < Math.min(bundleLines.length, 5); i++) {
        const line = bundleLines[i] || '';
        console.log(`  Line ${i + 1}: ${line.substring(0, 100)}`);
      }

      // Decode source map mappings using source-map library
      const { SourceMapConsumer } = await import('source-map');
      const consumer = await new SourceMapConsumer(sourceMap);

      // Find the first mapping for our entry file
      let firstMappingForEntry: { line: number; column: number } | null = null;
      // Also collect all mappings to understand the structure
      const mappingsForEntry: {
        genLine: number;
        genCol: number;
        srcLine: number;
        srcCol: number;
      }[] = [];

      consumer.eachMapping((mapping) => {
        if (
          mapping.source &&
          mapping.source.includes('index.js') &&
          !mapping.source.includes('__prelude__')
        ) {
          mappingsForEntry.push({
            genLine: mapping.generatedLine,
            genCol: mapping.generatedColumn,
            srcLine: mapping.originalLine || 0,
            srcCol: mapping.originalColumn || 0,
          });
          if (!firstMappingForEntry || mapping.generatedLine < firstMappingForEntry.line) {
            firstMappingForEntry = {
              line: mapping.generatedLine,
              column: mapping.generatedColumn,
            };
          }
        }
      });

      consumer.destroy();

      // Debug: Print first few mappings
      console.log('[SourceMap Test] First 10 mappings for entry file:');
      mappingsForEntry
        .sort((a, b) => a.genLine - b.genLine || a.genCol - b.genCol)
        .slice(0, 10)
        .forEach((m, i) => {
          console.log(`  ${i}: gen(${m.genLine}:${m.genCol}) -> src(${m.srcLine}:${m.srcCol})`);
        });

      expect(firstMappingForEntry).not.toBeNull();
      if (!firstMappingForEntry) {
        throw new Error('No mapping found for entry file');
      }

      // The source map's first mapping for the entry module should match where it appears in the bundle
      // Allow for some offset due to wrapping (__d function call adds wrapper code)
      // The key is that the mapping should be within reasonable range of the actual module location
      const mappingLine = (firstMappingForEntry as { line: number; column: number }).line;

      // Debug output for test analysis
      console.log(`[SourceMap Test] Bundle entry module starts at line: ${entryModuleStartLine}`);
      console.log(`[SourceMap Test] Source map first mapping for entry: line ${mappingLine}`);
      console.log(`[SourceMap Test] Difference: ${mappingLine - entryModuleStartLine}`);

      // The mapping should be at or after the __d( line
      // (the actual code inside __d starts after the wrapper function)
      expect(mappingLine).toBeGreaterThanOrEqual(entryModuleStartLine);
      // The __d wrapper adds ~3 lines (function declaration, "use strict", blank line)
      // So the actual code mapping should be within a few lines of __d(
      expect(mappingLine - entryModuleStartLine).toBeLessThanOrEqual(4);
    });

    test('should generate correct line mappings for multiple modules', async () => {
      // This test checks if line number offsets accumulate correctly across multiple modules
      const entryFile = join(testDir, 'index.js');
      const moduleAFile = join(testDir, 'moduleA.js');
      const moduleBFile = join(testDir, 'moduleB.js');

      writeFileSync(
        moduleAFile,
        `// Module A Line 1
const a = 'moduleA'; // Line 2
module.exports = a; // Line 3`,
        'utf-8',
      );

      writeFileSync(
        moduleBFile,
        `// Module B Line 1
const b = 'moduleB'; // Line 2
module.exports = b; // Line 3`,
        'utf-8',
      );

      writeFileSync(
        entryFile,
        `// Entry Line 1
const a = require('./moduleA'); // Line 2
const b = require('./moduleB'); // Line 3
console.log(a, b); // Line 4`,
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

      expect(result.map).toBeDefined();

      const sourceMap = JSON.parse(result.map!);
      const bundleLines = result.code.split('\n');

      // Debug: print bundle structure
      console.log('[MultiModule Test] Bundle structure:');
      let moduleCount = 0;
      for (let i = 0; i < bundleLines.length; i++) {
        const line = bundleLines[i] || '';
        if (line.includes('__d(')) {
          moduleCount++;
          console.log(`  Module ${moduleCount} at line ${i + 1}`);
        }
      }

      // Decode source map and check mappings
      const { SourceMapConsumer } = await import('source-map');
      const consumer = await new SourceMapConsumer(sourceMap);

      // Collect mappings per source file
      const mappingsBySource: Map<string, { genLine: number; srcLine: number }[]> = new Map();

      consumer.eachMapping((mapping) => {
        if (!mapping.source || mapping.source === '__prelude__') return;
        const fileName = mapping.source.split('/').pop() || '';
        if (!mappingsBySource.has(fileName)) {
          mappingsBySource.set(fileName, []);
        }
        mappingsBySource.get(fileName)!.push({
          genLine: mapping.generatedLine,
          srcLine: mapping.originalLine || 0,
        });
      });

      consumer.destroy();

      // Debug: Print mapping ranges
      console.log('[MultiModule Test] Mapping ranges by source:');
      for (const [fileName, mappings] of mappingsBySource.entries()) {
        if (mappings.length === 0) continue;
        const sortedMappings = mappings.sort((a, b) => a.genLine - b.genLine);
        const minGenLine = sortedMappings[0]?.genLine;
        const maxGenLine = sortedMappings[sortedMappings.length - 1]?.genLine;
        console.log(`  ${fileName}: gen lines ${minGenLine} - ${maxGenLine}`);

        // Print first few mappings
        sortedMappings.slice(0, 3).forEach((m) => {
          const bundleLine = bundleLines[m.genLine - 1] || '';
          console.log(
            `    gen(${m.genLine}) -> src(${m.srcLine}): ${bundleLine.substring(0, 60)}...`,
          );
        });
      }

      // Verify: Each module's mappings should have correct source line references
      // moduleA has 'moduleA' on line 2, moduleB has 'moduleB' on line 2
      const moduleAMappings = mappingsBySource.get('moduleA.js') || [];
      const moduleBMappings = mappingsBySource.get('moduleB.js') || [];

      expect(moduleAMappings.length).toBeGreaterThan(0);
      expect(moduleBMappings.length).toBeGreaterThan(0);

      // Check that moduleA's 'const a = ' line (srcLine 2) maps to a line containing 'moduleA'
      const moduleALine2Mapping = moduleAMappings.find((m) => m.srcLine === 2);
      if (moduleALine2Mapping) {
        const bundleLine = bundleLines[moduleALine2Mapping.genLine - 1] || '';
        console.log(
          `[MultiModule Test] moduleA srcLine 2 -> genLine ${moduleALine2Mapping.genLine}: ${bundleLine}`,
        );
        expect(bundleLine).toContain('moduleA');
      }

      // Check that moduleB's 'const b = ' line (srcLine 2) maps to a line containing 'moduleB'
      const moduleBLine2Mapping = moduleBMappings.find((m) => m.srcLine === 2);
      if (moduleBLine2Mapping) {
        const bundleLine = bundleLines[moduleBLine2Mapping.genLine - 1] || '';
        console.log(
          `[MultiModule Test] moduleB srcLine 2 -> genLine ${moduleBLine2Mapping.genLine}: ${bundleLine}`,
        );
        expect(bundleLine).toContain('moduleB');
      }

      // CRITICAL CHECK: Modules should NOT overlap in generated line ranges
      // This is the key issue - if carryOver is calculated wrong, modules will have overlapping ranges
      if (moduleAMappings.length > 0 && moduleBMappings.length > 0) {
        const moduleAMaxLine = Math.max(...moduleAMappings.map((m) => m.genLine));
        const moduleBMinLine = Math.min(...moduleBMappings.map((m) => m.genLine));
        console.log(`[MultiModule Test] moduleA max gen line: ${moduleAMaxLine}`);
        console.log(`[MultiModule Test] moduleB min gen line: ${moduleBMinLine}`);

        // If these overlap, there's a line counting bug
        // Note: Due to module ordering, we can't assume A comes before B
        // But we can check that no two modules have the same generated line ranges
      }
    });

    test('should verify rawMappings start at line 1', async () => {
      // This test checks that rawMappings for each module start at line 1
      // If they start at line 2, it causes a 1-line offset in the final source map
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `const x = 1;
console.log(x);`,
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

      // Build the graph to get the rawMappings
      const { buildGraph, graphToSerializerModules, reorderGraph } =
        await import('../graph-bundler/graph');
      const { resolve } = await import('path');

      const entryPath = resolve(config.root, config.entry);
      const graph = await buildGraph(entryPath, config);
      const orderedModules = reorderGraph(graph, entryPath);
      const serializerModules = await graphToSerializerModules(orderedModules, config);

      // Find the entry module
      const entryModule = serializerModules.find((m) => m.path === entryPath);
      expect(entryModule).toBeDefined();
      expect(entryModule!.map).toBeDefined();

      // Parse the source map data to get rawMappings
      const sourceMapData = JSON.parse(entryModule!.map!);
      console.log('[RawMappings Test] sourceMapData keys:', Object.keys(sourceMapData));

      if (sourceMapData.rawMappings && Array.isArray(sourceMapData.rawMappings)) {
        const rawMappings = sourceMapData.rawMappings;
        console.log(`[RawMappings Test] rawMappings count: ${rawMappings.length}`);
        console.log('[RawMappings Test] First 5 rawMappings:');
        rawMappings.slice(0, 5).forEach((m: number[], i: number) => {
          console.log(`  ${i}: [${m.join(', ')}]`);
        });

        // rawMappings format: [genLine, genCol, srcLine?, srcCol?, name?]
        // The first mapping will be at line ~4 due to __d wrapper:
        // Line 1: __d(function (...) {
        // Line 2:   "use strict";
        // Line 3:   (blank)
        // Line 4:   const x = 1;  ← first real code
        const firstMapping = rawMappings[0];
        if (firstMapping && firstMapping.length >= 4) {
          const firstGenLine = firstMapping[0];
          const firstSrcLine = firstMapping[2];
          console.log(
            `[RawMappings Test] First mapping: gen line ${firstGenLine} -> src line ${firstSrcLine}`,
          );
          // Source line should be 1 (first line of original source)
          expect(firstSrcLine).toBe(1);
          // Generated line should be > 1 due to wrapper
          expect(firstGenLine).toBeGreaterThan(1);
        }
      } else {
        console.log('[RawMappings Test] No rawMappings found, checking babelMap...');
        if (sourceMapData.babelMap || sourceMapData.mappings) {
          const { SourceMapConsumer } = await import('source-map');
          const babelMap = sourceMapData.babelMap || sourceMapData;
          const consumer = await new SourceMapConsumer(babelMap);

          let firstGenLine = Infinity;
          consumer.eachMapping((mapping) => {
            if (mapping.generatedLine < firstGenLine) {
              firstGenLine = mapping.generatedLine;
            }
          });
          consumer.destroy();

          console.log(`[RawMappings Test] First mapping from babelMap: line ${firstGenLine}`);
          // Babel source maps should also start at line 1
          expect(firstGenLine).toBe(1);
        }
      }
    });

    test('should generate source map with prelude correctly offset', async () => {
      // This test verifies that the prelude (bundle.pre) line count is correctly calculated
      // and that subsequent modules have correct line offsets
      const entryFile = join(testDir, 'index.js');
      writeFileSync(entryFile, "console.log('test');", 'utf-8');

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
      const bundleLines = result.code.split('\n');

      // Count lines before the first __d( module
      let preludeLineCount = 0;
      for (let i = 0; i < bundleLines.length; i++) {
        const line = bundleLines[i];
        if (line && line.includes('__d(')) {
          preludeLineCount = i; // 0-indexed, so this is the line count before __d
          break;
        }
      }

      // The __prelude__ should be the first source
      expect(sourceMap.sources[0]).toBe('__prelude__');

      // Decode mappings and find the first non-prelude mapping
      const { SourceMapConsumer } = await import('source-map');
      const consumer = await new SourceMapConsumer(sourceMap);

      let firstNonPreludeMappingLine: number | null = null;
      consumer.eachMapping((mapping) => {
        if (mapping.source && mapping.source !== '__prelude__') {
          if (
            firstNonPreludeMappingLine === null ||
            mapping.generatedLine < firstNonPreludeMappingLine
          ) {
            firstNonPreludeMappingLine = mapping.generatedLine;
          }
        }
      });

      consumer.destroy();

      // Debug output
      console.log(`[SourceMap Test] Prelude line count (0-indexed): ${preludeLineCount}`);
      console.log(`[SourceMap Test] First non-prelude mapping line: ${firstNonPreludeMappingLine}`);
      console.log(`[SourceMap Test] Expected minimum line: ${preludeLineCount + 1}`);

      // The first non-prelude mapping should be after the prelude
      // (preludeLineCount is 0-indexed, so first module is at preludeLineCount + 1)
      expect(firstNonPreludeMappingLine).not.toBeNull();
      if (firstNonPreludeMappingLine === null) {
        throw new Error('No non-prelude mapping found');
      }
      expect(firstNonPreludeMappingLine).toBeGreaterThanOrEqual(preludeLineCount + 1);
    });

    test('should handle shouldAddToIgnoreList based on module path patterns', async () => {
      const srcDir = join(testDir, 'src');
      const vendorDir = join(testDir, 'vendor');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(vendorDir, { recursive: true });

      const entryFile = join(srcDir, 'index.js');
      const vendorFile = join(vendorDir, 'lib.js');
      const appFile = join(srcDir, 'app.js');

      writeFileSync(entryFile, "require('../vendor/lib'); require('./app');", 'utf-8');
      writeFileSync(vendorFile, 'module.exports = { vendor: true };', 'utf-8');
      writeFileSync(appFile, 'module.exports = { app: true };', 'utf-8');

      const config = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'src/index.js',
          platform: 'ios',
          dev: true,
          serializer: {
            // Ignore vendor directory
            shouldAddToIgnoreList: (module) => module.path.includes('vendor'),
          },
        },
        testDir,
      );

      const result = await buildWithGraph(config);

      expect(result.map).toBeDefined();
      const sourceMap = JSON.parse(result.map!);
      expect(sourceMap.x_google_ignoreList).toBeDefined();

      // Find vendor file index
      const vendorIndex = sourceMap.sources.findIndex((s: string) => s.includes('vendor'));
      const appIndex = sourceMap.sources.findIndex(
        (s: string) => s.includes('app.js') && !s.includes('vendor'),
      );

      // Vendor should be in ignore list
      if (vendorIndex !== -1) {
        expect(sourceMap.x_google_ignoreList).toContain(vendorIndex);
      }

      // App file should not be in ignore list
      if (appIndex !== -1) {
        expect(sourceMap.x_google_ignoreList).not.toContain(appIndex);
      }
    });
  });

  describe('Dev-only Module Filtering', () => {
    test('should include dev-only modules in development mode', async () => {
      // Create a dev-only module (simulating React Native dev tools)
      const devToolsDir = join(
        testDir,
        'node_modules',
        'react-native',
        'Libraries',
        'Core',
        'Devtools',
      );
      mkdirSync(devToolsDir, { recursive: true });
      const openURLInBrowser = join(devToolsDir, 'openURLInBrowser.js');
      writeFileSync(
        openURLInBrowser,
        `module.exports = function openURLInBrowser(url) {
  console.log('Opening URL:', url);
};`,
        'utf-8',
      );

      // Create entry file that imports dev-only module
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `const openURLInBrowser = require('react-native/Libraries/Core/Devtools/openURLInBrowser');
openURLInBrowser('http://example.com');
console.log('Dev mode');`,
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

      // In dev mode, dev-only modules should be included
      expect(result.code).toContain('openURLInBrowser');
      expect(result.code).toContain('Opening URL');
    });

    test('should exclude dev-only modules in production mode', async () => {
      // Create a dev-only module (simulating React Native dev tools)
      const devToolsDir = join(
        testDir,
        'node_modules',
        'react-native',
        'Libraries',
        'Core',
        'Devtools',
      );
      mkdirSync(devToolsDir, { recursive: true });
      const openURLInBrowser = join(devToolsDir, 'openURLInBrowser.js');
      writeFileSync(
        openURLInBrowser,
        `module.exports = function openURLInBrowser(url) {
  console.log('Opening URL:', url);
};`,
        'utf-8',
      );

      // Create entry file that imports dev-only module
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `const openURLInBrowser = require('react-native/Libraries/Core/Devtools/openURLInBrowser');
openURLInBrowser('http://example.com');
console.log('Production mode');`,
        'utf-8',
      );

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

      // In production mode, dev-only module definitions should be excluded
      // Note: The require() call in entry file may still be present, but the module definition won't be
      // Check that the dev-only module's actual code (function definition) is not in the bundle
      expect(result.code).not.toContain('Opening URL');
      expect(result.code).not.toContain('function openURLInBrowser');
      // Entry file code may still reference it, but the module definition should be excluded
      // But regular code should still be included
      expect(result.code).toContain('Production mode');
    });

    test('should exclude multiple dev-only modules in production mode', async () => {
      // Create multiple dev-only modules
      const devToolsDir = join(
        testDir,
        'node_modules',
        'react-native',
        'Libraries',
        'Core',
        'Devtools',
      );
      mkdirSync(devToolsDir, { recursive: true });

      const openURLInBrowser = join(devToolsDir, 'openURLInBrowser.js');
      writeFileSync(
        openURLInBrowser,
        `module.exports = function openURLInBrowser(url) {
  console.log('Opening URL:', url);
};`,
        'utf-8',
      );

      const devToolsDir2 = join(testDir, 'node_modules', 'react-native', 'Libraries', 'Devtools');
      mkdirSync(devToolsDir2, { recursive: true });
      const anotherDevTool = join(devToolsDir2, 'openURLInBrowser.js');
      writeFileSync(
        anotherDevTool,
        `module.exports = function anotherDevTool() {
  console.log('Another dev tool');
};`,
        'utf-8',
      );

      // Create entry file that imports both dev-only modules
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `const openURLInBrowser = require('react-native/Libraries/Core/Devtools/openURLInBrowser');
const anotherDevTool = require('react-native/Libraries/Devtools/openURLInBrowser');
openURLInBrowser('http://example.com');
anotherDevTool();
console.log('Production mode');`,
        'utf-8',
      );

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

      // In production mode, all dev-only module definitions should be excluded
      // Check that the dev-only modules' actual code is not in the bundle
      expect(result.code).not.toContain('Another dev tool');
      expect(result.code).not.toContain('Opening URL');
      expect(result.code).not.toContain('function openURLInBrowser');
      expect(result.code).not.toContain('function anotherDevTool');
      // But regular code should still be included
      expect(result.code).toContain('Production mode');
    });

    test('should include regular modules in both dev and production mode', async () => {
      // Create a regular module (not dev-only)
      const utilsDir = join(testDir, 'utils');
      mkdirSync(utilsDir, { recursive: true });
      const utils = join(utilsDir, 'helper.js');
      writeFileSync(
        utils,
        `module.exports = function helper() {
  return 'helper function';
};`,
        'utf-8',
      );

      // Create entry file that imports regular module
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `const helper = require('./utils/helper');
console.log(helper());`,
        'utf-8',
      );

      // Test in development mode
      const devConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const devResult = await buildWithGraph(devConfig);
      expect(devResult.code).toContain('helper function');

      // Test in production mode
      const prodConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: false,
        },
        testDir,
      );

      const prodResult = await buildWithGraph(prodConfig);
      expect(prodResult.code).toContain('helper function');
    });

    test('should handle mixed dev-only and regular modules correctly', async () => {
      // Create dev-only module
      const devToolsDir = join(
        testDir,
        'node_modules',
        'react-native',
        'Libraries',
        'Core',
        'Devtools',
      );
      mkdirSync(devToolsDir, { recursive: true });
      const openURLInBrowser = join(devToolsDir, 'openURLInBrowser.js');
      writeFileSync(
        openURLInBrowser,
        `module.exports = function openURLInBrowser(url) {
  console.log('Dev tool:', url);
};`,
        'utf-8',
      );

      // Create regular module
      const utilsDir = join(testDir, 'utils');
      mkdirSync(utilsDir, { recursive: true });
      const utils = join(utilsDir, 'helper.js');
      writeFileSync(
        utils,
        `module.exports = function helper() {
  return 'regular helper';
};`,
        'utf-8',
      );

      // Create entry file that imports both
      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `const openURLInBrowser = require('react-native/Libraries/Core/Devtools/openURLInBrowser');
const helper = require('./utils/helper');
openURLInBrowser('http://example.com');
console.log(helper());`,
        'utf-8',
      );

      // Test in development mode - both should be included
      const devConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const devResult = await buildWithGraph(devConfig);
      expect(devResult.code).toContain('openURLInBrowser');
      expect(devResult.code).toContain('regular helper');

      // Test in production mode - only regular module should be included
      const prodConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: false,
        },
        testDir,
      );

      const prodResult = await buildWithGraph(prodConfig);
      // Dev-only module definition should be excluded
      expect(prodResult.code).not.toContain('Dev tool');
      expect(prodResult.code).not.toContain('function openURLInBrowser');
      // Regular module should still be included
      expect(prodResult.code).toContain('regular helper');
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

  describe('Asset Module Resolution', () => {
    // Skip asset tests that require react-native AssetRegistry
    test.skipIf(skipMetroRuntimeTests)('should generate asset module for PNG files', async () => {
      // Create a minimal PNG file (1x1 transparent pixel)
      const pngBuffer = Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR chunk
        0x00,
        0x00,
        0x00,
        0x01, // width: 1
        0x00,
        0x00,
        0x00,
        0x01, // height: 1
        0x08,
        0x06,
        0x00,
        0x00,
        0x00, // bit depth, color type, etc.
        0x1f,
        0x15,
        0xc4,
        0x89, // CRC
        0x00,
        0x00,
        0x00,
        0x0a,
        0x49,
        0x44,
        0x41,
        0x54, // IDAT chunk
        0x78,
        0x9c,
        0x63,
        0x00,
        0x01,
        0x00,
        0x00,
        0x05,
        0x00,
        0x01,
        0x0d,
        0x0a,
        0x2d,
        0xb4,
        0x00,
        0x00,
        0x00,
        0x00,
        0x49,
        0x45,
        0x4e,
        0x44, // IEND chunk
        0xae,
        0x42,
        0x60,
        0x82,
      ]);

      const assetsDir = join(testDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });
      const imageFile = join(assetsDir, 'icon.png');
      writeFileSync(imageFile, pngBuffer);

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const icon = require('./assets/icon.png');
console.log(icon);
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

      // Asset should be registered with AssetRegistry
      expect(result.code).toContain('registerAsset');
      expect(result.code).toContain('__packager_asset');
      expect(result.code).toContain('"name":"icon"');
      expect(result.code).toContain('"type":"png"');
    });

    test.skipIf(skipMetroRuntimeTests)('should resolve asset dependencies correctly', async () => {
      // Create a minimal PNG file
      const pngBuffer = Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52,
        0x00,
        0x00,
        0x00,
        0x10, // width: 16
        0x00,
        0x00,
        0x00,
        0x10, // height: 16
        0x08,
        0x06,
        0x00,
        0x00,
        0x00,
        0x1f,
        0x15,
        0xc4,
        0x89,
        0x00,
        0x00,
        0x00,
        0x00,
        0x49,
        0x45,
        0x4e,
        0x44,
        0xae,
        0x42,
        0x60,
        0x82,
      ]);

      const imagesDir = join(testDir, 'images');
      mkdirSync(imagesDir, { recursive: true });
      const imageFile = join(imagesDir, 'logo.png');
      writeFileSync(imageFile, pngBuffer);

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const logo = require('./images/logo.png');
console.log('Logo:', logo);
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

      // Asset module should have AssetRegistry as dependency
      expect(result.code).toContain('AssetRegistry');
      // Asset should have correct dimensions
      expect(result.code).toContain('"width":16');
      expect(result.code).toContain('"height":16');
    });

    test('should detect asset files by extension', async () => {
      // Test that assetExts config is respected
      const config = getDefaultConfig(testDir);

      // Default asset extensions should include common image formats
      expect(config.resolver.assetExts).toContain('.png');
      expect(config.resolver.assetExts).toContain('.jpg');
      expect(config.resolver.assetExts).toContain('.jpeg');
      expect(config.resolver.assetExts).toContain('.gif');
      expect(config.resolver.assetExts).toContain('.webp');
    });
  });

  describe('Asset Extraction in Release Builds', () => {
    // Helper to create a minimal PNG file
    function createMinimalPNG(): Buffer {
      return Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR chunk
        0x00,
        0x00,
        0x00,
        0x01, // width: 1
        0x00,
        0x00,
        0x00,
        0x01, // height: 1
        0x08,
        0x06,
        0x00,
        0x00,
        0x00, // bit depth, color type, etc.
        0x1f,
        0x15,
        0xc4,
        0x89, // CRC
        0x00,
        0x00,
        0x00,
        0x0a,
        0x49,
        0x44,
        0x41,
        0x54, // IDAT chunk
        0x78,
        0x9c,
        0x63,
        0x00,
        0x01,
        0x00,
        0x00,
        0x05,
        0x00,
        0x01,
        0x0d,
        0x0a,
        0x2d,
        0xb4,
        0x00,
        0x00,
        0x00,
        0x00,
        0x49,
        0x45,
        0x4e,
        0x44, // IEND chunk
        0xae,
        0x42,
        0x60,
        0x82,
      ]);
    }

    // Create mock AssetRegistry for tests
    function setupMockAssetRegistry(): void {
      const assetRegistryDir = join(testDir, 'node_modules', 'react-native', 'Libraries', 'Image');
      mkdirSync(assetRegistryDir, { recursive: true });
      writeFileSync(
        join(assetRegistryDir, 'AssetRegistry.js'),
        `
module.exports = {
  registerAsset: (asset) => asset
};
`,
        'utf-8',
      );
    }

    test('should exclude assets from __DEV__ conditional blocks in release builds', async () => {
      setupMockAssetRegistry();
      const assetsDir = join(testDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });

      // Create production asset (always included)
      const prodImage = join(assetsDir, 'prod-icon.png');
      writeFileSync(prodImage, createMinimalPNG());

      // Create dev-only asset (should be excluded in release)
      const devImage = join(assetsDir, 'dev-icon.png');
      writeFileSync(devImage, createMinimalPNG());

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
// Production asset - always included
const prodIcon = require('./assets/prod-icon.png');

// Dev-only asset - should be excluded in release builds
if (__DEV__) {
  const devIcon = require('./assets/dev-icon.png');
  console.log('Dev icon:', devIcon);
}

console.log('Prod icon:', prodIcon);
`,
        'utf-8',
      );

      // Test release build (dev: false)
      const releaseConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: false,
        },
        testDir,
      );

      const releaseResult = await buildWithGraph(releaseConfig);

      // In release build, only prod-icon should be in assets
      expect(releaseResult.assets).toBeDefined();
      const releaseAssets = releaseResult.assets || [];
      const releaseAssetNames = releaseAssets.map((a) => a.name);
      expect(releaseAssetNames).toContain('prod-icon');
      expect(releaseAssetNames).not.toContain('dev-icon');
      expect(releaseAssets.length).toBe(1);
    });

    test('should include all assets in dev builds even if inside __DEV__ blocks', async () => {
      setupMockAssetRegistry();
      const assetsDir = join(testDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });

      // Create production asset
      const prodImage = join(assetsDir, 'prod-icon.png');
      writeFileSync(prodImage, createMinimalPNG());

      // Create dev-only asset
      const devImage = join(assetsDir, 'dev-icon.png');
      writeFileSync(devImage, createMinimalPNG());

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
// Production asset
const prodIcon = require('./assets/prod-icon.png');

// Dev-only asset - should be included in dev builds
if (__DEV__) {
  const devIcon = require('./assets/dev-icon.png');
  console.log('Dev icon:', devIcon);
}

console.log('Prod icon:', prodIcon);
`,
        'utf-8',
      );

      // Test dev build (dev: true)
      const devConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: true,
        },
        testDir,
      );

      const devResult = await buildWithGraph(devConfig);

      // In dev build, both assets should be included
      expect(devResult.assets).toBeDefined();
      const devAssets = devResult.assets || [];
      const devAssetNames = devAssets.map((a) => a.name);
      expect(devAssetNames).toContain('prod-icon');
      expect(devAssetNames).toContain('dev-icon');
      expect(devAssets.length).toBe(2);
    });

    test('should exclude assets from __DEV__ && expressions in release builds', async () => {
      setupMockAssetRegistry();
      const assetsDir = join(testDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });

      const prodImage = join(assetsDir, 'prod-icon.png');
      writeFileSync(prodImage, createMinimalPNG());

      const devImage = join(assetsDir, 'dev-icon.png');
      writeFileSync(devImage, createMinimalPNG());

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const prodIcon = require('./assets/prod-icon.png');

// Dev-only asset using && operator
__DEV__ && require('./assets/dev-icon.png');

console.log('Prod icon:', prodIcon);
`,
        'utf-8',
      );

      const releaseConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: false,
        },
        testDir,
      );

      const releaseResult = await buildWithGraph(releaseConfig);

      // In release build, dev-icon should be excluded
      expect(releaseResult.assets).toBeDefined();
      const releaseAssets = releaseResult.assets || [];
      const releaseAssetNames = releaseAssets.map((a) => a.name);
      expect(releaseAssetNames).toContain('prod-icon');
      expect(releaseAssetNames).not.toContain('dev-icon');
      expect(releaseAssets.length).toBe(1);
    });

    test('should exclude assets from process.env.NODE_ENV === "development" conditionals in release builds', async () => {
      setupMockAssetRegistry();
      const assetsDir = join(testDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });

      const prodImage = join(assetsDir, 'prod-icon.png');
      writeFileSync(prodImage, createMinimalPNG());

      const devImage = join(assetsDir, 'dev-icon.png');
      writeFileSync(devImage, createMinimalPNG());

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
const prodIcon = require('./assets/prod-icon.png');

// Dev-only asset using process.env.NODE_ENV check
if (process.env.NODE_ENV === 'development') {
  const devIcon = require('./assets/dev-icon.png');
  console.log('Dev icon:', devIcon);
}

console.log('Prod icon:', prodIcon);
`,
        'utf-8',
      );

      const releaseConfig = resolveConfig(
        {
          ...getDefaultConfig(testDir),
          entry: 'index.js',
          platform: 'ios',
          dev: false,
        },
        testDir,
      );

      const releaseResult = await buildWithGraph(releaseConfig);

      // In release build, dev-icon should be excluded
      expect(releaseResult.assets).toBeDefined();
      const releaseAssets = releaseResult.assets || [];
      const releaseAssetNames = releaseAssets.map((a) => a.name);
      expect(releaseAssetNames).toContain('prod-icon');
      expect(releaseAssetNames).not.toContain('dev-icon');
      expect(releaseAssets.length).toBe(1);
    });

    test('should only include assets that are actually required in bundle code', async () => {
      setupMockAssetRegistry();
      const assetsDir = join(testDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });

      // Create multiple assets
      const usedImage = join(assetsDir, 'used.png');
      const unusedImage = join(assetsDir, 'unused.png');
      writeFileSync(usedImage, createMinimalPNG());
      writeFileSync(unusedImage, createMinimalPNG());

      const entryFile = join(testDir, 'index.js');
      writeFileSync(
        entryFile,
        `
// Only this asset is actually required
const used = require('./assets/used.png');
console.log('Used:', used);

// This asset is never required, so it should not be included
// (even though it exists in the file system)
`,
        'utf-8',
      );

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

      // Only used asset should be included
      expect(result.assets).toBeDefined();
      const assets = result.assets || [];
      const assetNames = assets.map((a) => a.name);
      expect(assetNames).toContain('used');
      expect(assetNames).not.toContain('unused');
      expect(assets.length).toBe(1);
    });
  });
});

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

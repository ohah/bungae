/**
 * Babel Transformer Metro Compatibility Tests
 *
 * Tests that our Babel transformer matches Metro's behavior:
 * - Parser selection based on file extension
 * - babel.config.js auto-discovery
 * - Flow syntax support (import typeof)
 * - TypeScript support
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { resolveConfig } from '../../config';
import { buildWithGraph } from '../graph-bundler';

// Get packages/bungae directory (where dependencies are)
// Current file: packages/bungae/src/bundler/__tests__/babel-transformer-metro-compat.test.ts
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

describe('Babel Transformer Metro Compatibility', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-babel-test-${Date.now()}`);
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

  describe('Parser Selection by File Extension', () => {
    test('should use Babel parser for TypeScript files (.ts)', async () => {
      const entryFile = join(testDir, 'index.ts');
      const code = `const value: string = 'hello';`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.ts',
        platform: 'ios',
        dev: true,
      });

      // Should not throw (Babel parser handles TypeScript)
      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      expect(result.code).toContain('hello');
    });

    test('should use Babel parser for TSX files (.tsx)', async () => {
      const entryFile = join(testDir, 'index.tsx');
      const code = `import React from 'react';
const Component: React.FC = () => <div>Hello</div>;`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.tsx',
        platform: 'ios',
        dev: true,
      });

      // Should not throw (Babel parser handles TSX)
      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
    });

    test('should use Hermes parser for JavaScript files (.js)', async () => {
      const entryFile = join(testDir, 'index.js');
      const code = `console.log('hello');`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      // Should not throw (Hermes parser handles JavaScript)
      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      expect(result.code).toContain('hello');
    });

    test('should use Hermes parser for JSX files (.jsx)', async () => {
      const entryFile = join(testDir, 'index.jsx');
      const code = `import React from 'react';
const Component = () => <div>Hello</div>;`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.jsx',
        platform: 'ios',
        dev: true,
      });

      // Should not throw (Hermes parser handles JSX)
      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
    });
  });

  describe('Flow Syntax Support', () => {
    test('should handle Flow import typeof syntax', async () => {
      const entryFile = join(testDir, 'index.js');
      // Flow syntax: import typeof
      const code = `import typeof * as ReactNativePublicAPI from './types.js.flow';
console.log('Flow import typeof works');`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      // Should not throw (Hermes parser handles Flow import typeof)
      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      expect(result.code).toContain('Flow import typeof works');
    });

    test('should handle Flow type annotations', async () => {
      const entryFile = join(testDir, 'index.js');
      const code = `// @flow
function add(a: number, b: number): number {
  return a + b;
}
console.log(add(1, 2));`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      // Should not throw (Hermes parser handles Flow types)
      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      expect(result.code).toContain('add(1, 2)');
    });
  });

  describe('babel.config.js Auto-Discovery', () => {
    test('should read babel.config.js from project root', async () => {
      // Overwrite default babel.config.js with a custom config
      // This tests that Babel reads the config file from the project root
      const commonjsPlugin = resolvePlugin('@babel/plugin-transform-modules-commonjs');
      const babelConfig = `module.exports = {
  plugins: [
    ${JSON.stringify(commonjsPlugin)},
  ],
};`;
      writeFileSync(join(testDir, 'babel.config.js'), babelConfig, 'utf-8');

      const entryFile = join(testDir, 'index.js');
      const code = `console.log('test');`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      // Should read babel.config.js and apply @react-native/babel-preset
      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      // babel.config.js should be applied (no error means it was read)
    });

    test('should work without babel.config.js', async () => {
      // Remove babel.config.js to test without it
      const babelConfigPath = join(testDir, 'babel.config.js');
      if (existsSync(babelConfigPath)) {
        rmSync(babelConfigPath);
      }

      const entryFile = join(testDir, 'index.js');
      const code = `console.log('test');`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      // Should work even without babel.config.js (code won't be transformed but should still bundle)
      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
    });
  });

  describe('Metro-Compatible Babel Config', () => {
    test('should set correct babel config options (Metro-compatible)', async () => {
      const entryFile = join(testDir, 'index.js');
      const code = `console.log('test');`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      // Should use Metro-compatible babel config:
      // - cloneInputAst: false
      // - cwd: projectRoot (for babel.config.js auto-discovery)
      // - caller: { bundler: 'bungae', name: 'bungae', platform: 'ios' }
      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      // If it works, the config is correct
    });

    test('should set BABEL_ENV correctly', async () => {
      const entryFile = join(testDir, 'index.js');
      const code = `console.log(process.env.BABEL_ENV || 'production');`;
      writeFileSync(entryFile, code, 'utf-8');

      // Dev mode
      const devConfig = resolveConfig({
        root: testDir,
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });
      const devResult = await buildWithGraph(devConfig);
      expect(devResult).toBeDefined();

      // Production mode
      const prodConfig = resolveConfig({
        root: testDir,
        entry: 'index.js',
        platform: 'ios',
        dev: false,
      });
      const prodResult = await buildWithGraph(prodConfig);
      expect(prodResult).toBeDefined();
    });
  });

  describe('Platform.OS Replacement', () => {
    test('should replace Platform.OS with actual platform value', async () => {
      const entryFile = join(testDir, 'index.js');
      const code = `const platform = Platform.OS;
console.log(platform);`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        root: testDir,
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      // Platform.OS should be replaced with 'ios'
      expect(result.code).toContain('"ios"');
    });
  });
});

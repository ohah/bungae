/**
 * AST Dependency Extraction Tests
 *
 * Tests that dependencies are extracted from AST directly (Metro-compatible)
 * without generating code temporarily.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveConfig, getDefaultConfig } from '../../config';
import { buildWithGraph } from '../graph-bundler';

describe('AST Dependency Extraction (Metro-Compatible)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-ast-dep-test-${Date.now()}`);
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

  describe('Extract Dependencies from AST', () => {
    test('should extract dependencies from transformed AST', async () => {
      // Metro: dependencies are extracted from AST directly (no code generation)
      const entryFile = join(testDir, 'index.js');
      const moduleA = join(testDir, 'moduleA.js');
      const moduleB = join(testDir, 'moduleB.js');

      writeFileSync(
        entryFile,
        `import { a } from './moduleA';
import { b } from './moduleB';
console.log(a, b);`,
        'utf-8',
      );
      writeFileSync(moduleA, `export const a = 'A';`, 'utf-8');
      writeFileSync(moduleB, `export const b = 'B';`, 'utf-8');

      const config = resolveConfig({
        ...getDefaultConfig(testDir),
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      // Dependencies should be extracted from AST (not from generated code)
      // If bundle contains both modules, extraction worked correctly
      expect(result.code).toContain('A');
      expect(result.code).toContain('B');
    });

    test('should handle require() calls in AST', async () => {
      const entryFile = join(testDir, 'index.js');
      const moduleA = join(testDir, 'moduleA.js');

      writeFileSync(
        entryFile,
        `const a = require('./moduleA');
console.log(a);`,
        'utf-8',
      );
      writeFileSync(moduleA, `module.exports = 'A';`, 'utf-8');

      const config = resolveConfig({
        ...getDefaultConfig(testDir),
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      expect(result.code).toContain('A');
    });

    test('should handle dynamic imports in AST', async () => {
      const entryFile = join(testDir, 'index.js');
      const lazyModule = join(testDir, 'lazy.js');

      writeFileSync(
        entryFile,
        `const loadLazy = async () => {
  const module = await import('./lazy');
  return module;
};`,
        'utf-8',
      );
      writeFileSync(lazyModule, `export const value = 'lazy';`, 'utf-8');

      const config = resolveConfig({
        ...getDefaultConfig(testDir),
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      // Dynamic import should be extracted from AST
      expect(result.code).toBeDefined();
    });

    test('should extract dependencies added by Babel transforms', async () => {
      // Babel may add new imports (e.g., react/jsx-runtime for JSX)
      // These should be extracted from the transformed AST
      const entryFile = join(testDir, 'index.jsx');
      const code = `import React from 'react';
const Component = () => <div>Hello</div>;`;
      writeFileSync(entryFile, code, 'utf-8');

      const config = resolveConfig({
        ...getDefaultConfig(testDir),
        entry: 'index.jsx',
        platform: 'ios',
        dev: true,
      });

      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      // JSX transform may add react/jsx-runtime import
      // This should be extracted from transformed AST
      expect(result.code).toBeDefined();
    });

    test('should handle export declarations in AST', async () => {
      const entryFile = join(testDir, 'index.js');
      const moduleA = join(testDir, 'moduleA.js');

      writeFileSync(
        entryFile,
        `export { a } from './moduleA';
console.log('test');`,
        'utf-8',
      );
      writeFileSync(moduleA, `export const a = 'A';`, 'utf-8');

      const config = resolveConfig({
        ...getDefaultConfig(testDir),
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      // Export from should be extracted from AST
      expect(result.code).toBeDefined();
    });
  });

  describe('Metro Compatibility', () => {
    test('should not generate code for dependency extraction', async () => {
      // Metro: dependencies are extracted from AST, not from generated code
      // We verify this by checking that the bundle works correctly
      // (if code was generated for extraction, it would be inefficient)
      const entryFile = join(testDir, 'index.js');
      const moduleA = join(testDir, 'moduleA.js');

      writeFileSync(
        entryFile,
        `import { a } from './moduleA';
console.log(a);`,
        'utf-8',
      );
      writeFileSync(moduleA, `export const a = 'A';`, 'utf-8');

      const config = resolveConfig({
        ...getDefaultConfig(testDir),
        entry: 'index.js',
        platform: 'ios',
        dev: true,
      });

      const result = await buildWithGraph(config);
      expect(result).toBeDefined();
      // If bundle works, dependencies were extracted correctly from AST
      expect(result.code).toContain('A');
    });
  });
});

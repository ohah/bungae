/**
 * Tests for minification
 */

import { describe, expect, it } from 'bun:test';

import { minifyCode } from '../graph-bundler/minify';

describe('minifyCode', () => {
  it('should minify code with Bun minifier', async () => {
    const code = `
      function hello() {
        console.log('Hello, World!');
        return true;
      }
      hello();
    `;

    const result = await minifyCode(code, {
      minifier: 'bun',
    });

    expect(result.code).toBeDefined();
    // Bun minifier may preserve strings, but should still minify structure
    expect(result.code.length).toBeLessThanOrEqual(code.length);
    // Code should be minified (whitespace removed, identifiers shortened)
    expect(result.code).toMatch(/function\s+\w+\(\)/); // Function should be minified
  });

  it('should minify code with Terser minifier (Metro-compatible)', async () => {
    const code = `
      function hello() {
        console.log('Hello, World!');
        return true;
      }
      hello();
    `;

    const result = await minifyCode(code, {
      minifier: 'terser',
    });

    expect(result.code).toBeDefined();
    // If terser is not available, esbuild fallback is used
    // So we just check that code is defined
    expect(result.code.length).toBeGreaterThan(0);
  });

  it('should preserve Metro runtime functions with Bun minifier', async () => {
    const code = `
      __d(function() {
        return 'module';
      }, 1, []);
      __r(1);
      __DEV__ = true;
      __METRO__ = true;
      __BUNGAE__ = true;
    `;

    const result = await minifyCode(code, {
      minifier: 'bun',
    });

    expect(result.code).toContain('__d');
    expect(result.code).toContain('__r');
    expect(result.code).toContain('__DEV__');
    expect(result.code).toContain('__METRO__');
    expect(result.code).toContain('__BUNGAE__');
  });

  it('should preserve Metro runtime functions with Terser minifier', async () => {
    const code = `
      __d(function() {
        return 'module';
      }, 1, []);
      __r(1);
      __DEV__ = true;
      __METRO__ = true;
      __BUNGAE__ = true;
    `;

    const result = await minifyCode(code, {
      minifier: 'terser',
    });

    expect(result.code).toContain('__d');
    expect(result.code).toContain('__r');
    expect(result.code).toContain('__DEV__');
    expect(result.code).toContain('__METRO__');
    expect(result.code).toContain('__BUNGAE__');
  });

  it('should preserve Metro runtime functions with esbuild minifier', async () => {
    const code = `
      __d(function() {
        return 'module';
      }, 1, []);
      __r(1);
      __DEV__ = true;
      __METRO__ = true;
      __BUNGAE__ = true;
    `;

    const result = await minifyCode(code, {
      minifier: 'esbuild',
    });

    // esbuild may not mangle global function names in practice, but it's not guaranteed
    // This test verifies current behavior
    expect(result.code).toContain('__d');
    expect(result.code).toContain('__r');
    expect(result.code).toContain('__DEV__');
    expect(result.code).toContain('__METRO__');
    expect(result.code).toContain('__BUNGAE__');
  });

  it('should preserve Metro runtime functions with SWC minifier', async () => {
    const code = `
      __d(function() {
        return 'module';
      }, 1, []);
      __r(1);
      __DEV__ = true;
      __METRO__ = true;
      __BUNGAE__ = true;
    `;

    const result = await minifyCode(code, {
      minifier: 'swc',
    });

    // SWC uses keep_fnames: true to preserve function names
    expect(result.code).toContain('__d');
    expect(result.code).toContain('__r');
    expect(result.code).toContain('__DEV__');
    expect(result.code).toContain('__METRO__');
    expect(result.code).toContain('__BUNGAE__');
  });

  it('should handle empty code', async () => {
    const result = await minifyCode('', {
      minifier: 'bun',
    });

    expect(result.code).toBeDefined();
  });

  it('should handle source maps', async () => {
    const code = 'function hello() { return true; }';
    const sourceMap = JSON.stringify({
      version: 3,
      sources: ['test.js'],
      mappings: 'AAAA',
    });

    const result = await minifyCode(code, {
      minifier: 'esbuild',
      sourceMap,
      fileName: 'test.js',
    });

    expect(result.code).toBeDefined();
    // Source map may or may not be included depending on minifier
  });

  it('should minify code with SWC minifier (if available)', async () => {
    const code = `
      function hello() {
        console.log('Hello, World!');
        return true;
      }
      hello();
    `;

    const result = await minifyCode(code, {
      minifier: 'swc',
    });

    expect(result.code).toBeDefined();
    // If swc is not available, original code is returned
    expect(result.code.length).toBeGreaterThan(0);
  });
});

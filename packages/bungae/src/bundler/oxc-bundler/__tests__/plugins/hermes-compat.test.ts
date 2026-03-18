import { describe, expect, it } from 'bun:test';

import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

import { hermesCompatPlugin } from '../../plugins/hermes-compat';

describe('hermesCompatPlugin', () => {
  const plugin = hermesCompatPlugin();

  it('should have correct plugin name', () => {
    expect(plugin.name).toBe('bungae:hermes-compat');
  });

  it('should have renderChunk hook', () => {
    expect(plugin.renderChunk).toBeDefined();
  });

  // Helper to call renderChunk handler
  async function callRenderChunk(code: string) {
    const hook = plugin.renderChunk as {
      handler: (code: string, chunk: any) => Promise<any>;
    };
    return hook.handler(code, {});
  }

  describe('SWC es5 transform (renderChunk)', () => {
    it('should transform class expressions to functions', async () => {
      const code = `var Foo = class Foo1 { constructor() { this.x = 1; } };`;
      const result = await callRenderChunk(code);
      expect(result.code).not.toContain('= class');
      expect(result.code).toContain('function Foo1');
    });

    it('should transform private class fields', async () => {
      const code = `class Foo { #value = 42; getValue() { return this.#value; } }`;
      const result = await callRenderChunk(code);
      expect(result.code).not.toContain('#value');
    });

    it('should transform private methods', async () => {
      const code = `class Bar { #doSomething() { return 'hello'; } run() { return this.#doSomething(); } }`;
      const result = await callRenderChunk(code);
      expect(result.code).not.toContain('#doSomething');
    });

    it('should transform let/const to var', async () => {
      const code = `const a = 1; let b = 2;`;
      const result = await callRenderChunk(code);
      expect(result.code).toContain('var a');
      expect(result.code).toContain('var b');
    });

    it('should transform arrow functions', async () => {
      const code = `const fn = () => 42;`;
      const result = await callRenderChunk(code);
      expect(result.code).not.toContain('=>');
    });

    it('should preserve source maps', async () => {
      const code = `class Foo { #x = 1; }`;
      const result = await callRenderChunk(code);
      expect(result.map).toBeDefined();
    });
  });

  // (void 0) workaround removed — root cause fixed in flow-strip (CJS moduleType detection).
  // See flow-strip-cjs.test.ts for the actual fix verification.

  describe('__defProp patch', () => {
    it('should patch __defProp to set configurable: true', async () => {
      const code = `var __defProp = Object.defineProperty; __defProp({}, "x", { value: 1 });`;
      const result = await callRenderChunk(code);
      expect(result.code).toContain('desc.configurable = true');
      expect(result.code).not.toContain('var __defProp = Object.defineProperty');
    });
  });

  describe('source map accuracy', () => {
    function findLineCol(code: string, search: string): { line: number; column: number } {
      const lines = code.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const col = lines[i]!.indexOf(search);
        if (col !== -1) return { line: i + 1, column: col };
      }
      throw new Error(`"${search}" not found in code`);
    }

    it('should map SWC es5 output back to original line', async () => {
      const code = 'var a = 1;\nvar b = () => 42;\nvar c = 3;';
      const result = await callRenderChunk(code);
      const map = new TraceMap(result.map);

      // "var b" should exist in output (arrow fn → function)
      const outputPos = findLineCol(result.code, 'var b');
      const original = originalPositionFor(map, outputPos);

      // Should map back to line 2 in original (where "var b = () => 42;" was)
      expect(original.line).toBe(2);
    });

    it('should map lines after __defProp patch correctly', async () => {
      const code = 'var __defProp = Object.defineProperty;\nvar userCode = 1;\nvar more = 2;';
      const result = await callRenderChunk(code);
      const map = new TraceMap(result.map);

      // "var userCode" is on line 2 of the original
      const outputPos = findLineCol(result.code, 'var userCode');
      const original = originalPositionFor(map, outputPos);
      expect(original.line).toBe(2);

      // "var more" is on line 3 of the original
      const outputPos2 = findLineCol(result.code, 'var more');
      const original2 = originalPositionFor(map, outputPos2);
      expect(original2.line).toBe(3);
    });

    it('should map lines after __defProp patch with multiple vars', async () => {
      const code = [
        'var __defProp = Object.defineProperty;',
        'var first = 1;',
        'var second = 2;',
        'var userVar = 42;',
      ].join('\n');
      const result = await callRenderChunk(code);
      const map = new TraceMap(result.map);

      // "var userVar" is on line 4 of the original
      const outputPos = findLineCol(result.code, 'var userVar');
      const original = originalPositionFor(map, outputPos);
      expect(original.line).toBe(4);
    });
  });
});

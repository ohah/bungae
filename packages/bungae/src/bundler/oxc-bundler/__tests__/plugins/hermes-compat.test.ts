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
  // __defProp patch removed — fixed in Rolldown fork (configurable: true in runtime helpers).

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

      const outputPos = findLineCol(result.code, 'var b');
      const original = originalPositionFor(map, outputPos);
      expect(original.line).toBe(2);
    });

    it('should map multiple vars correctly', async () => {
      const code = 'var first = 1;\nvar second = () => 2;\nvar third = 3;';
      const result = await callRenderChunk(code);
      const map = new TraceMap(result.map);

      const outputPos = findLineCol(result.code, 'var third');
      const original = originalPositionFor(map, outputPos);
      expect(original.line).toBe(3);
    });
  });
});

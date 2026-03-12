import { describe, expect, it } from 'bun:test';

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
    const hook = plugin.renderChunk as { handler: (code: string, chunk: any) => Promise<any> };
    return hook.handler(code, {});
  }

  it('should transform class expressions to functions (ES5)', async () => {
    const code = `var Foo = class Foo1 {
  constructor() { this.x = 1; }
  getX() { return this.x; }
};`;
    const result = await callRenderChunk(code);
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('= class');
    // Should be converted to function
    expect(result.code).toContain('function');
  });

  it('should transform private class fields', async () => {
    const code = `class Foo {
  #value = 42;
  getValue() { return this.#value; }
}`;
    const result = await callRenderChunk(code);
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('#value');
  });

  it('should transform private methods', async () => {
    const code = `class Bar {
  #doSomething() { return 'hello'; }
  run() { return this.#doSomething(); }
}`;
    const result = await callRenderChunk(code);
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('#doSomething');
  });

  it('should transform arrow functions to regular functions', async () => {
    const code = `var fn = () => 42;`;
    const result = await callRenderChunk(code);
    expect(result).not.toBeNull();
    expect(result.code).toContain('function');
  });

  it('should preserve source maps', async () => {
    const code = `class Foo { #x = 1; getX() { return this.#x; } }`;
    const result = await callRenderChunk(code);
    expect(result).not.toBeNull();
    expect(result.map).toBeDefined();
  });

  it('should handle multiple private fields', async () => {
    const code = `class Point {
  #x; #y;
  constructor(x, y) { this.#x = x; this.#y = y; }
  toString() { return this.#x + "," + this.#y; }
}`;
    const result = await callRenderChunk(code);
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('#x');
    expect(result.code).not.toContain('#y');
  });

  it('should handle class expression assigned to variable', async () => {
    const code = `var DOMRectReadOnly = class DOMRectReadOnly {
  get x() { return 1; }
  constructor() {}
};`;
    const result = await callRenderChunk(code);
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('= class');
  });
});

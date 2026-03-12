import { describe, expect, it } from 'bun:test';

import { hermesCompatPlugin } from '../../plugins/hermes-compat';

describe('hermesCompatPlugin', () => {
  const plugin = hermesCompatPlugin();

  it('should have correct plugin name', () => {
    expect(plugin.name).toBe('bungae:hermes-compat');
  });

  it('should have transform hook', () => {
    expect(plugin.transform).toBeDefined();
  });

  // Helper to call transform handler
  async function callTransform(code: string, id = 'test.js') {
    const transform = plugin.transform as (code: string, id: string) => Promise<any>;
    return transform.call(plugin, code, id);
  }

  it('should skip non-JS files', async () => {
    const result = await callTransform('class Foo { #x = 1; }', 'test.css');
    expect(result).toBeNull();
  });

  it('should skip code without # character', async () => {
    const result = await callTransform('var x = 1; function foo() { return x; }');
    expect(result).toBeNull();
  });

  it('should skip code with # in comments but no private fields', async () => {
    const result = await callTransform('// #region start\nvar x = 1;\n// #endregion');
    expect(result).toBeNull();
  });

  it('should skip code with # in strings but no private fields', async () => {
    const result = await callTransform('var x = "color: #ff0000";');
    expect(result).toBeNull();
  });

  it('should skip code with # in sourcemap comments', async () => {
    const result = await callTransform(
      'var x = 1;\n//# sourceMappingURL=data:application/json;base64,abc',
    );
    expect(result).toBeNull();
  });

  it('should transform private class fields', async () => {
    const code = `
class Foo {
  #value = 42;
  getValue() {
    return this.#value;
  }
}
`;
    const result = await callTransform(code);
    expect(result).not.toBeNull();
    expect(result.code).toBeDefined();
    // Should not contain private field syntax
    expect(result.code).not.toContain('#value');
    // Should contain loose mode polyfill pattern
    expect(result.code).toContain('_class_private_field_loose');
    // Should NOT contain comma+class expression pattern
    expect(result.code).not.toContain(', class ');
  });

  it('should transform private methods', async () => {
    const code = `
class Bar {
  #doSomething() {
    return 'hello';
  }
  run() {
    return this.#doSomething();
  }
}
`;
    const result = await callTransform(code);
    expect(result).not.toBeNull();
    expect(result.code).toBeDefined();
    expect(result.code).not.toContain('#doSomething');
  });

  it('should preserve source maps', async () => {
    const code = `
class Foo {
  #x = 1;
  getX() { return this.#x; }
}
`;
    const result = await callTransform(code);
    expect(result).not.toBeNull();
    expect(result.map).toBeDefined();
  });

  it('should handle accessor patterns like .#field', async () => {
    const code = `
class Container {
  #items = [];
  add(item) { this.#items.push(item); }
  get count() { return this.#items.length; }
}
`;
    const result = await callTransform(code);
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('#items');
  });

  it('should handle multiple private fields in one class', async () => {
    const code = `
class Point {
  #x;
  #y;
  constructor(x, y) {
    this.#x = x;
    this.#y = y;
  }
  toString() { return this.#x + "," + this.#y; }
}
`;
    const result = await callTransform(code);
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('#x');
    expect(result.code).not.toContain('#y');
  });

  it('should handle TypeScript files', async () => {
    const code = `
class Foo {
  #value: number = 42;
  getValue(): number {
    return this.#value;
  }
}
`;
    const result = await callTransform(code, 'test.ts');
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('#value');
  });
});

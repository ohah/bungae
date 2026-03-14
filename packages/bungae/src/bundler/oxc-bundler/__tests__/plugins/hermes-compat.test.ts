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

  describe('SWC es5 transform', () => {
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

  describe('@__PURE__ stripping (SWC bug workaround)', () => {
    it('should strip @__PURE__ annotations before SWC', async () => {
      const code = `var x = /* @__PURE__ */ (0, fn)(args);`;
      const result = await callRenderChunk(code);
      expect(result.code).not.toContain('@__PURE__');
    });

    it('should preserve (0, fn)() call in && context after stripping', async () => {
      // SWC bug: `&& /* @__PURE__ */ (0, fn)(args)` → `&& (void 0)(args)`.
      // Stripping @__PURE__ prevents this.
      const code = `var x = true && /* @__PURE__ */ (0, fn)(Text, { children: "test" });`;
      const result = await callRenderChunk(code);
      expect(result.code).not.toContain('void 0)(');
      expect(result.code).toContain('(0, fn)');
    });

    it('should preserve regular && without (0, fn)', async () => {
      const code = `var x = a && b && c;`;
      const result = await callRenderChunk(code);
      expect(result.code).toContain('&&');
    });
  });

  describe('__defProp patch', () => {
    it('should patch __defProp to set configurable: true', async () => {
      const code = `var __defProp = Object.defineProperty; __defProp({}, "x", { value: 1 });`;
      const result = await callRenderChunk(code);
      expect(result.code).toContain('desc.configurable = true');
      expect(result.code).not.toContain('var __defProp = Object.defineProperty');
    });
  });

  describe('&& pattern runtime behavior', () => {
    async function transformAndEval(code: string): Promise<any> {
      const result = await callRenderChunk(code);
      return new Function(result.code + '\nreturn typeof __test_result__ !== "undefined" ? __test_result__ : undefined;')();
    }

    it('&& should be converted to ternary and work correctly', async () => {
      const code = `
var jsx = function(type, props) { return { type: type, props: props }; };
var jsxs = function(type, props) { return { type: type, props: props }; };

function render(info) {
  return jsxs('View', {
    children: [
      jsx('Text', { children: "always" }),
      info === 'done' && /* @__PURE__ */ (0, jsx)('Text', { children: "conditional" })
    ]
  });
}

var __test_result__ = {
  first: render('loading'),
  second: render('done')
};`;
      const result = await transformAndEval(code);
      // First render: && returns false when condition is falsy
      expect(result.first.props.children[1]).toBe(false);
      // Re-render: returns element
      expect(result.second.props.children[1].props.children).toBe('conditional');
    });
  });
});

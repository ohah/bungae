import { describe, expect, it } from 'bun:test';

import { hermesCompatPlugin } from '../../plugins/hermes-compat';

describe('hermesCompatPlugin', () => {
  const plugin = hermesCompatPlugin();

  it('should have correct plugin name', () => {
    expect(plugin.name).toBe('bungae:hermes-compat');
  });

  it('should have transform and renderChunk hooks', () => {
    expect(plugin.transform).toBeDefined();
    expect(plugin.renderChunk).toBeDefined();
  });

  // Helper to call transform handler (per-module SWC es5)
  async function callTransform(code: string, id = '/test/module.js') {
    const hook = plugin.transform as { handler: (code: string, id: string) => Promise<any>; filter: any };
    return hook.handler(code, id);
  }

  // Helper to call renderChunk handler (__defProp patch)
  function callRenderChunk(code: string) {
    const hook = plugin.renderChunk as { handler: (code: string, chunk: any) => any };
    return hook.handler(code, {});
  }

  // Helper to transform and eval code, returning result
  async function transformAndEval(code: string): Promise<any> {
    const result = await callTransform(code);
    if (!result?.code) throw new Error('Transform returned null');
    return new Function(result.code + '\nreturn typeof __test_result__ !== "undefined" ? __test_result__ : undefined;')();
  }

  describe('private fields transform (per-module, es2015)', () => {
    it('should transform private class fields', async () => {
      const code = `class Foo {
  #value = 42;
  getValue() { return this.#value; }
}`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('#value');
    });

    it('should transform private methods', async () => {
      const code = `class Bar {
  #doSomething() { return 'hello'; }
  run() { return this.#doSomething(); }
}`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('#doSomething');
    });

    it('should skip modules without # (no private fields)', async () => {
      const result = await callTransform('class Foo { x = 1; }', '/test/normal.js');
      expect(result).toBeNull();
    });

    it('should skip json files', async () => {
      const result = await callTransform('{"key": "value"}', '/test/data.json');
      expect(result).toBeNull();
    });

    it('should preserve let/const (es2015 target)', async () => {
      const code = `class Foo { #x = 1; } const a = 1; let b = 2;`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('#x');
      expect(result.code).toContain('const ');
      expect(result.code).toContain('let ');
    });

    it('should preserve arrow functions', async () => {
      const code = `class Foo { #x = 1; } const fn = () => 42;`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).toContain('=>');
    });

    it('should preserve class expressions (Hermes 0.83 supports them)', async () => {
      const code = `var Bar = class Bar { #val = 1; };`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('#val');
      expect(result.code).toContain('class');
    });

    it('should handle multiple private fields', async () => {
      const code = `class Point {
  #x; #y;
  constructor(x, y) { this.#x = x; this.#y = y; }
  toString() { return this.#x + "," + this.#y; }
}`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('#x');
      expect(result.code).not.toContain('#y');
    });
  });

  describe('__defProp patch (renderChunk)', () => {
    it('should patch __defProp to set configurable: true', () => {
      const code = `var __defProp = Object.defineProperty;
var obj = {};
__defProp(obj, "foo", { get: function() { return 1; }, enumerable: true });`;
      const result = callRenderChunk(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('var __defProp = Object.defineProperty;');
      expect(result.code).toContain('desc.configurable = true');
    });
  });

  describe('&& conditional rendering pattern (no SWC needed)', () => {
    // These patterns are NOT transformed by hermes-compat (no private fields).
    // Tests verify the patterns work correctly without any SWC intervention.

    function evalCode(code: string): any {
      return new Function(code + '\nreturn typeof __test_result__ !== "undefined" ? __test_result__ : undefined;')();
    }

    it('&& with (0, fn)() should work for both false and truthy conditions', () => {
      const code = `
var jsx = function(type, props) { return { type: type, props: props }; };
var jsxs = function(type, props) { return { type: type, props: props }; };

function render(info) {
  return jsxs('View', {
    children: [
      jsx('Text', { children: "always" }),
      info === 'done' && (0, jsx)('Text', { children: "conditional" })
    ]
  });
}

var __test_result__ = {
  first: render('loading'),
  second: render('done')
};`;
      const result = evalCode(code);
      expect(result.first.props.children[1]).toBe(false);
      expect(result.second.props.children[1].props.children).toBe('conditional');
    });

    it('Rolldown __esmMin + && pattern should work', () => {
      const code = `
var __esmMin = function(fn, res) { return function() { if (fn) { res = fn(fn = 0); } return res; }; };
var __exportAll = function(all) {
  var target = {};
  for (var k in all) Object.defineProperty(target, k, { get: all[k], enumerable: true });
  return target;
};
var __toCommonJS = function(mod) { return mod; };

var jsx_exports = __exportAll({ jsx: function() { return jsx_fn; }, jsxs: function() { return jsxs_fn; } });
var jsx_fn, jsxs_fn;
var init_jsx = __esmMin(function() {
  jsx_fn = function(type, props) { return { type: type, props: props }; };
  jsxs_fn = function(type, props) { return { type: type, props: props }; };
});

function App(info) {
  var j = (init_jsx(), __toCommonJS(jsx_exports));
  return (0, j.jsxs)('View', {
    children: [
      (0, j.jsx)('Text', { children: 'always' }),
      info === 'done' && (0, j.jsx)('Text', { children: 'conditional' })
    ]
  });
}

init_jsx();
var __test_result__ = {
  loading: App('loading').props.children[1],
  done: App('done').props.children[1].props.children,
};`;
      const result = evalCode(code);
      expect(result.loading).toBe(false);
      expect(result.done).toBe('conditional');
    });
  });

  describe('source maps', () => {
    it('should preserve source maps from transform', async () => {
      const code = `class Foo { #x = 1; getX() { return this.#x; } }`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.map).toBeDefined();
    });
  });
});

import { describe, expect, it } from 'bun:test';

import { hermesCompatPlugin } from '../../plugins/hermes-compat';

describe('hermesCompatPlugin', () => {
  const plugin = hermesCompatPlugin(true);

  it('should have correct plugin name', () => {
    expect(plugin.name).toBe('bungae:hermes-compat');
  });

  it('should have transform and renderChunk hooks', () => {
    expect(plugin.transform).toBeDefined();
    expect(plugin.renderChunk).toBeDefined();
  });

  // Helper to call transform handler (per-module SWC es5 + JSX)
  async function callTransform(code: string, id = '/test/module.js') {
    const hook = plugin.transform as {
      handler: (code: string, id: string) => Promise<any>;
      filter: any;
    };
    return hook.handler(code, id);
  }

  // Helper to call renderChunk handler (__defProp patch)
  function callRenderChunk(code: string) {
    const hook = plugin.renderChunk as { handler: (code: string, chunk: any) => any };
    return hook.handler(code, {});
  }

  describe('ES5 transform (per-module)', () => {
    it('should transform class expressions to functions', async () => {
      const code = `var Foo = class Foo1 { constructor() { this.x = 1; } };`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('= class');
      expect(result.code).toContain('function Foo1');
    });

    it('should transform private class fields', async () => {
      const code = `class Foo { #value = 42; getValue() { return this.#value; } }`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('#value');
    });

    it('should transform private methods', async () => {
      const code = `class Bar { #doSomething() { return 'hello'; } run() { return this.#doSomething(); } }`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('#doSomething');
    });

    it('should transform let/const to var', async () => {
      const code = `const a = 1; let b = 2;`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).toContain('var a');
      expect(result.code).toContain('var b');
    });

    it('should transform arrow functions', async () => {
      const code = `const fn = () => 42;`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('=>');
    });

    it('should skip json files', async () => {
      const result = await callTransform('{"key": "value"}', '/test/data.json');
      expect(result).toBeNull();
    });

    it('should preserve source maps', async () => {
      const code = `class Foo { #x = 1; }`;
      const result = await callTransform(code);
      expect(result).not.toBeNull();
      expect(result.map).toBeDefined();
    });
  });

  describe('JSX transform (per-module)', () => {
    it('should transform JSX to jsx() calls', async () => {
      const code = `const el = <div>hello</div>;`;
      const result = await callTransform(code, '/test/component.jsx');
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('<div>');
      // Should use jsxDEV in dev mode
      expect(result.code).toContain('jsxDEV');
    });

    it('should transform TSX to jsx() calls', async () => {
      const code = `const el: JSX.Element = <div>hello</div>;`;
      const result = await callTransform(code, '/test/component.tsx');
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('<div>');
      expect(result.code).toContain('jsxDEV');
    });

    it('should handle && with JSX correctly (no void 0 bug)', async () => {
      const code = `
function App() {
  return <div>{true && <span>test</span>}</div>;
}`;
      const result = await callTransform(code, '/test/app.jsx');
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('void 0)(');
      expect(result.code).toContain('&&');
    });
  });

  describe('__defProp patch (renderChunk)', () => {
    it('should patch __defProp to set configurable: true', () => {
      const code = `var __defProp = Object.defineProperty; __defProp({}, "x", { value: 1 });`;
      const result = callRenderChunk(code);
      expect(result).not.toBeNull();
      expect(result.code).toContain('desc.configurable = true');
      expect(result.code).not.toContain('var __defProp = Object.defineProperty');
    });

    it('should not modify code when __defProp pattern is absent', () => {
      const code = `var x = 1;`;
      const result = callRenderChunk(code);
      expect(result.code).toBe(code);
    });
  });

  describe('production mode', () => {
    const prodPlugin = hermesCompatPlugin(false);

    it('should use jsx instead of jsxDEV in production', async () => {
      const hook = prodPlugin.transform as {
        handler: (code: string, id: string) => Promise<any>;
      };
      const code = `const el = <div>hello</div>;`;
      const result = await hook.handler(code, '/test/component.jsx');
      expect(result).not.toBeNull();
      // Production should NOT use jsxDEV
      expect(result.code).not.toContain('jsxDEV');
    });
  });
});

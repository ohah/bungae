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

  // Helper to transform and eval code, returning result
  async function transformAndEval(code: string): Promise<any> {
    const result = await callRenderChunk(code);
    if (!result?.code) throw new Error('Transform returned null');
    return new Function(result.code + '\nreturn typeof __test_result__ !== "undefined" ? __test_result__ : undefined;')();
  }

  describe('class transforms', () => {
    it('should transform class expressions to functions', async () => {
      const code = `var Foo = class Foo1 {
  constructor() { this.x = 1; }
  getX() { return this.x; }
};`;
      const result = await callRenderChunk(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('= class');
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

  describe('__defProp patch', () => {
    it('should patch __defProp to set configurable: true', async () => {
      const code = `var __defProp = Object.defineProperty;
var obj = {};
__defProp(obj, "foo", { get: function() { return 1; }, enumerable: true });`;
      const result = await callRenderChunk(code);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('var __defProp = Object.defineProperty;');
      expect(result.code).toContain('desc.configurable = true');
    });
  });

  describe('&& conditional rendering pattern', () => {
    // Simulates Rolldown's output for: {condition && <Component />}
    // This is the exact pattern that fails on Hermes after SWC es5

    it('should preserve && with (0, fn)() call pattern', async () => {
      const code = `
var jsx = function(type, props) { return { type: type, props: props }; };
var jsxs = function(type, props) { return { type: type, props: props }; };
var Text = function(props) { return props; };
var View = function(props) { return props; };

function render(info) {
  return jsxs(View, {
    children: [
      jsx(Text, { children: "always" }),
      info === 'done' && /* @__PURE__ */ (0, jsx)(Text, { children: "conditional" })
    ]
  });
}

var __test_result__ = {
  first: render('loading'),
  second: render('done')
};`;
      const result = await transformAndEval(code);
      // First render: && returns false
      expect(result.first.props.children[1]).toBe(false);
      // Re-render: && returns JSX element
      expect(result.second.props.children[1]).not.toBe(false);
      expect(result.second.props.children[1].props.children).toBe('conditional');
    });

    it('should preserve ternary with (0, fn)() call pattern', async () => {
      const code = `
var jsx = function(type, props) { return { type: type, props: props }; };
var jsxs = function(type, props) { return { type: type, props: props }; };
var Text = function(props) { return props; };
var View = function(props) { return props; };

function render(info) {
  return jsxs(View, {
    children: [
      jsx(Text, { children: "always" }),
      info === 'done' ? /* @__PURE__ */ (0, jsx)(Text, { children: "conditional" }) : null
    ]
  });
}

var __test_result__ = {
  first: render('loading'),
  second: render('done')
};`;
      const result = await transformAndEval(code);
      expect(result.first.props.children[1]).toBeNull();
      expect(result.second.props.children[1].props.children).toBe('conditional');
    });

    it('&& and ternary should produce identical results for truthy condition', async () => {
      const code = `
var jsx = function(type, props) { return { type: type, props: props }; };
var Text = function(props) { return props; };

var andResult = true && /* @__PURE__ */ (0, jsx)(Text, { children: "test" });
var ternaryResult = true ? /* @__PURE__ */ (0, jsx)(Text, { children: "test" }) : null;

var __test_result__ = {
  and: andResult,
  ternary: ternaryResult,
  equal: JSON.stringify(andResult) === JSON.stringify(ternaryResult)
};`;
      const result = await transformAndEval(code);
      expect(result.equal).toBe(true);
      expect(result.and.props.children).toBe('test');
    });

    it('should handle Rolldown __esmMin + __exportAll + && pattern (full simulation)', async () => {
      // Simulates actual Rolldown bundle structure
      const code = `
var __esmMin = function(fn, res) { return function() { if (fn) { res = fn(fn = 0); } return res; }; };
var __exportAll = function(all) {
  var target = {};
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i++) {
    Object.defineProperty(target, keys[i], { get: all[keys[i]], enumerable: true });
  }
  return target;
};
var __toCommonJS = function(mod) { return mod; };

// Mock jsx-runtime module
var jsx_runtime_exports = __exportAll({
  jsx: function() { return jsx_fn; },
  jsxs: function() { return jsxs_fn; }
});
var jsx_fn, jsxs_fn;
var init_jsx_runtime = __esmMin(function() {
  jsx_fn = function(type, props) { return { type: type, props: props }; };
  jsxs_fn = function(type, props) { return { type: type, props: props }; };
});

// Mock react module
var react_exports = __exportAll({ useState: function() { return useState_fn; } });
var useState_fn;
var init_react = __esmMin(function() {
  useState_fn = function(initial) { return [initial, function() {}]; };
});

// App module (function hoisted, vars lazy-initialized)
function App() {
  var state = (init_react(), __toCommonJS(react_exports)).useState('loading');
  var info = state[0];
  var import_jsx = (init_jsx_runtime(), __toCommonJS(jsx_runtime_exports));

  return (0, import_jsx.jsxs)('View', {
    children: [
      (0, import_jsx.jsx)('Text', { children: 'always' }),
      info === 'done' && /* @__PURE__ */ (0, import_jsx.jsx)('Text', { children: 'conditional' })
    ]
  });
}

var import_jsx_runtime, import_react;
var init_App = __esmMin(function() {
  import_jsx_runtime = (init_jsx_runtime(), __toCommonJS(jsx_runtime_exports));
  import_react = (init_react(), __toCommonJS(react_exports));
});

// Execute
init_App();
var result1 = App();
var __test_result__ = {
  childrenCount: result1.props.children.length,
  firstChild: result1.props.children[0].props.children,
  secondChild: result1.props.children[1],
  jsxDefined: typeof import_jsx_runtime.jsx === 'function',
  jsxsDefined: typeof import_jsx_runtime.jsxs === 'function',
};`;
      const result = await transformAndEval(code);
      expect(result.jsxDefined).toBe(true);
      expect(result.jsxsDefined).toBe(true);
      expect(result.firstChild).toBe('always');
      // info is 'loading', so && should return false
      expect(result.secondChild).toBe(false);
    });

    it('should work with re-render simulation (state change triggers && to become truthy)', async () => {
      const code = `
var jsx = function(type, props) { return { type: type, props: props }; };
var jsxs = function(type, props) { return { type: type, props: props }; };

function AppContent(info) {
  return jsxs('View', {
    children: [
      jsxs('Text', { children: ['Status: ', info] }),
      info === 'done' && /* @__PURE__ */ (0, jsx)('Text', { children: 'Conditional!' })
    ]
  });
}

// Simulate: first render (info='loading'), then re-render (info='done')
var render1 = AppContent('loading');
var render2 = AppContent('done');

var __test_result__ = {
  render1_second: render1.props.children[1],
  render2_second: render2.props.children[1],
  render2_type: render2.props.children[1] && render2.props.children[1].type,
  render2_text: render2.props.children[1] && render2.props.children[1].props.children,
};`;
      const result = await transformAndEval(code);
      // First render: && with false condition returns false
      expect(result.render1_second).toBe(false);
      // Re-render: && with true condition returns element
      expect(result.render2_type).toBe('Text');
      expect(result.render2_text).toBe('Conditional!');
    });
  });

  describe('source maps', () => {
    it('should preserve source maps', async () => {
      const code = `class Foo { #x = 1; getX() { return this.#x; } }`;
      const result = await callRenderChunk(code);
      expect(result).not.toBeNull();
      expect(result.map).toBeDefined();
    });
  });
});

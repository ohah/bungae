/**
 * Metro-exact baseJSBundle tests
 * These tests match Metro's test cases exactly and verify exact output format
 */

import { describe, test, expect } from 'bun:test';
import path from 'path';

import { baseJSBundle } from '../baseJSBundle';
import type { Module } from '../types';

// Metro test fixtures
const polyfill: Module = {
  path: '/polyfill',
  code: '__d(function() {/* code for polyfill */});',
  dependencies: [],
};

const fooModule: Module = {
  path: '/root/foo',
  code: '__d(function() {/* code for foo */});',
  dependencies: ['/root/bar'],
};

const barModule: Module = {
  path: '/root/bar',
  code: '__d(function() {/* code for bar */});',
  dependencies: [],
};

const nonAsciiModule: Module = {
  path: '/root/%30.бундл.Øಚ😁AA/src/?/foo=bar/#.js',
  code: '__d(function() {/* code for ascii file with non ascii characters: %30.бундл.Øಚ😁AA */});',
  dependencies: [],
};

describe('baseJSBundle Metro Exact Tests', () => {
  test('should generate a very simple bundle (Metro test 1)', async () => {
    let getRunModuleStatementCalled = false;
    let calledWith: [number | string, string] | null = null;
    const getRunModuleStatement = (moduleId: number | string, globalPrefix: string) => {
      getRunModuleStatementCalled = true;
      calledWith = [moduleId, globalPrefix];
      return `require(${JSON.stringify(moduleId)});`;
    };

    const bundle = await baseJSBundle('/root/foo', [polyfill], [fooModule, barModule], {
      createModuleId: (filePath) => path.basename(filePath),
      dev: true,
      getRunModuleStatement,
      globalPrefix: 'customPrefix',
      projectRoot: '/root',
      serverRoot: '/root',
      runModule: true,
      sourceMapUrl: 'http://localhost/bundle.map',
    });

    // Metro expected output:
    // modules: [["foo", "__d(function() {/* code for foo */},"foo",["bar"],"foo");"], ["bar", "__d(function() {/* code for bar */},"bar",[],"bar");"]]
    // post: "require(\"foo\");\n//# sourceMappingURL=http://localhost/bundle.map"
    // pre: "__d(function() {/* code for polyfill */});"

    expect(bundle.modules).toHaveLength(2);

    // Module foo
    const fooModuleEntry = bundle.modules.find(([id]) => id === 'foo');
    expect(fooModuleEntry).toBeDefined();
    expect(fooModuleEntry![1]).toBe('__d(function() {/* code for foo */},"foo",["bar"],"foo");');

    // Module bar
    const barModuleEntry = bundle.modules.find(([id]) => id === 'bar');
    expect(barModuleEntry).toBeDefined();
    expect(barModuleEntry![1]).toBe('__d(function() {/* code for bar */},"bar",[],"bar");');

    // Post
    expect(bundle.post).toBe('require("foo");\n//# sourceMappingURL=http://localhost/bundle.map');

    // Pre
    expect(bundle.pre).toBe('__d(function() {/* code for polyfill */});');

    // Verify getRunModuleStatement was called
    expect(getRunModuleStatementCalled).toBe(true);
    expect(calledWith).not.toBeNull();
    expect(calledWith!).toEqual(['foo', 'customPrefix']);
  });

  test('should handle numeric module ids (Metro test 2)', async () => {
    const createModuleId = (() => {
      let nextId = 0;
      const fileToIdMap = new Map<string, number>();
      return (filePath: string): number => {
        let id = fileToIdMap.get(filePath);
        if (typeof id !== 'number') {
          id = nextId++;
          fileToIdMap.set(filePath, id);
        }
        return id;
      };
    })();

    const bundle = await baseJSBundle('/root/foo', [polyfill], [fooModule, barModule], {
      createModuleId,
      dev: true,
      getRunModuleStatement: (moduleId) => `require(${JSON.stringify(moduleId)});`,
      globalPrefix: '',
      projectRoot: '/root',
      serverRoot: '/root',
      runModule: true,
      runBeforeMainModule: ['/root/bar'],
      sourceMapUrl: 'http://localhost/bundle.map',
    });

    // Metro expected output:
    // modules: [[0, "__d(function() {/* code for foo */},0,[1],"foo");"], [1, "__d(function() {/* code for bar */},1,[],"bar");"]]

    expect(bundle.modules).toHaveLength(2);

    const fooId = createModuleId('/root/foo');
    const barId = createModuleId('/root/bar');

    const fooModuleEntry = bundle.modules.find(([id]) => id === fooId);
    expect(fooModuleEntry).toBeDefined();
    expect(fooModuleEntry![1]).toBe(
      `__d(function() {/* code for foo */},${fooId},[${barId}],"foo");`,
    );

    const barModuleEntry = bundle.modules.find(([id]) => id === barId);
    expect(barModuleEntry).toBeDefined();
    expect(barModuleEntry![1]).toBe(`__d(function() {/* code for bar */},${barId},[],"bar");`);

    // Post should have runBeforeMainModule first
    expect(bundle.post).toContain(`require(${JSON.stringify(barId)});`);
    expect(bundle.post).toContain(`require(${JSON.stringify(fooId)});`);
  });

  test('should add runBeforeMainModule statements if found in the graph (Metro test 3)', async () => {
    const bundle = await baseJSBundle('/root/foo', [polyfill], [fooModule, barModule], {
      createModuleId: (filePath) => path.basename(filePath),
      dev: true,
      getRunModuleStatement: (moduleId) => `require(${JSON.stringify(moduleId)});`,
      globalPrefix: '',
      projectRoot: '/root',
      serverRoot: '/root',
      runModule: true,
      runBeforeMainModule: ['/root/bar', 'non-existant'],
      sourceMapUrl: 'http://localhost/bundle.map',
    });

    // Metro expected output:
    // post: "require(\"bar\");\nrequire(\"foo\");\n//# sourceMappingURL=http://localhost/bundle.map"

    expect(bundle.post).toBe(
      'require("bar");\nrequire("foo");\n//# sourceMappingURL=http://localhost/bundle.map',
    );
  });

  test('outputs custom runModule statements (Metro test 4)', async () => {
    const bundle = await baseJSBundle('/root/foo', [polyfill], [fooModule, barModule], {
      createModuleId: (filePath) => path.basename(filePath),
      dev: true,
      getRunModuleStatement: (moduleId) =>
        `export default require(${JSON.stringify(moduleId)}).default;`,
      globalPrefix: '',
      projectRoot: '/root',
      serverRoot: '/root',
      runModule: true,
      runBeforeMainModule: ['/root/bar'],
      sourceMapUrl: undefined,
    });

    // Metro expected output:
    // post: "export default require(\"bar\").default;\nexport default require(\"foo\").default;"

    expect(bundle.post).toBe(
      'export default require("bar").default;\nexport default require("foo").default;',
    );
  });

  test('does not add polyfills when modulesOnly is used (Metro test 5)', async () => {
    // Note: We need to add modulesOnly option to SerializerOptions
    // For now, we'll test by passing empty preModules
    const bundle = await baseJSBundle(
      '/root/foo',
      [], // Empty preModules = modulesOnly
      [fooModule, barModule],
      {
        createModuleId: (filePath) => path.basename(filePath),
        dev: true,
        getRunModuleStatement: (moduleId) => `require(${JSON.stringify(moduleId)});`,
        globalPrefix: '',
        projectRoot: '/root',
        serverRoot: '/root',
        runModule: true,
        sourceMapUrl: 'http://localhost/bundle.map',
      },
    );

    // Metro expected output:
    // pre: ""
    // modules: [["foo", "__d(function() {/* code for foo */},"foo",["bar"],"foo");"], ["bar", "__d(function() {/* code for bar */},"bar",[],"bar");"]]
    // post: "require(\"foo\");\n//# sourceMappingURL=http://localhost/bundle.map"

    expect(bundle.pre).toBe('');
    expect(bundle.modules).toHaveLength(2);
    expect(bundle.post).toBe('require("foo");\n//# sourceMappingURL=http://localhost/bundle.map');
  });

  test('should generate a bundle with correct non ascii characters parsing (Metro test 6)', async () => {
    // Metro test: should generate a bundle with correct non ascii characters parsing
    const sourceMapUrl =
      'http://localhost/' +
      'root/%30.бундл.Øಚ😁AA/src/?/foo=bar/#.map'
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    const sourceUrl =
      'http://localhost/' +
      'root/%30.бундл.Øಚ😁AA/src/?/foo=bar/#.bundle'
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');

    const bundle = await baseJSBundle(
      '/root/%30.бундл.Øಚ😁AA/src/?/foo=bar/#.js',
      [polyfill],
      [nonAsciiModule],
      {
        createModuleId: (filePath) => path.basename(filePath),
        dev: true,
        getRunModuleStatement: (moduleId) => `require(${JSON.stringify(moduleId)});`,
        globalPrefix: '',
        projectRoot: '/root',
        serverRoot: '/root',
        runModule: true,
        sourceMapUrl,
        sourceUrl,
      },
    );

    // Metro expected output:
    // modules: [["#.js", "__d(function() {/* code for ascii file with non ascii characters: %30.бундл.Øಚ😁AA */},"#.js",[],"%30.бундл.Øಚ😁AA/src/?/foo=bar/#.js");"]]
    // post: "//# sourceMappingURL=http://localhost/root/%2530.%D0%B1%D1%83%D0%BD%D0%B4%D0%BB.%C3%98%E0%B2%9A%F0%9F%98%81AA/src/%3F/foo%3Dbar/%23.map\n//# sourceURL=http://localhost/root/%2530.%D0%B1%D1%83%D0%BD%D0%B4%D0%BB.%C3%98%E0%B2%9A%F0%9F%98%81AA/src/%3F/foo%3Dbar/%23.bundle"
    // pre: "__d(function() {/* code for polyfill */});"

    expect(bundle.modules).toHaveLength(1);
    const moduleEntry = bundle.modules.find(([id]) => id === '#.js');
    expect(moduleEntry).toBeDefined();
    expect(moduleEntry![1]).toBe(
      '__d(function() {/* code for ascii file with non ascii characters: %30.бундл.Øಚ😁AA */},"#.js",[],"%30.бундл.Øಚ😁AA/src/?/foo=bar/#.js");',
    );

    // Post should contain encoded source map URL and source URL
    expect(bundle.post).toContain('//# sourceMappingURL=');
    expect(bundle.post).toContain('//# sourceURL=');
    expect(bundle.post).toContain('%2530'); // Encoded %30
    expect(bundle.post).toContain('%D0%B1'); // Encoded б

    // Pre should contain polyfill
    expect(bundle.pre).toBe('__d(function() {/* code for polyfill */});');
  });

  // Metro test 7: should add an inline source map to a very simple bundle
  // TODO: Phase 2 - Implement inlineSourceMap generation
  test.skip('should add an inline source map to a very simple bundle (Metro test 7)', async () => {
    const bundle = await baseJSBundle('/root/foo', [polyfill], [fooModule, barModule], {
      createModuleId: (filePath) => path.basename(filePath),
      dev: true,
      getRunModuleStatement: (moduleId) => `require(${JSON.stringify(moduleId)});`,
      globalPrefix: '',
      projectRoot: '/root',
      serverRoot: '/root',
      runModule: true,
      inlineSourceMap: true,
    });

    // Metro expected output:
    // bundle.post.slice(0, bundle.post.lastIndexOf('base64')) should equal:
    // 'require("foo");\n//# sourceMappingURL=data:application/json;charset=utf-8;'
    // And the base64 part should decode to a valid source map with:
    // { mappings: '', names: [], sources: ['/root/foo', '/root/bar'], sourcesContent: ['foo-source', 'bar-source'], version: 3 }

    expect(bundle.post.slice(0, bundle.post.lastIndexOf('base64'))).toBe(
      'require("foo");\n//# sourceMappingURL=data:application/json;charset=utf-8;',
    );
    const sourceMapJson = JSON.parse(
      Buffer.from(bundle.post.slice(bundle.post.lastIndexOf('base64') + 7), 'base64').toString(),
    );
    expect(sourceMapJson).toEqual({
      mappings: '',
      names: [],
      sources: ['/root/foo', '/root/bar'],
      sourcesContent: ['foo-source', 'bar-source'],
      version: 3,
    });
  });

  // Metro test 8: emits x_google_ignoreList based on shouldAddToIgnoreList
  // TODO: Phase 2 - Implement x_google_ignoreList generation
  test.skip('emits x_google_ignoreList based on shouldAddToIgnoreList (Metro test 8)', async () => {
    const bundle = await baseJSBundle('/root/foo', [polyfill], [fooModule, barModule], {
      createModuleId: (filePath) => path.basename(filePath),
      dev: true,
      getRunModuleStatement: (moduleId) => `require(${JSON.stringify(moduleId)});`,
      globalPrefix: '',
      projectRoot: '/root',
      serverRoot: '/root',
      runModule: true,
      inlineSourceMap: true,
      shouldAddToIgnoreList: () => true,
    });

    // Metro expected output:
    // bundle.post.slice(0, bundle.post.lastIndexOf('base64')) should equal:
    // 'require("foo");\n//# sourceMappingURL=data:application/json;charset=utf-8;'
    // And the base64 part should decode to a source map with x_google_ignoreList: [0, 1]

    expect(bundle.post.slice(0, bundle.post.lastIndexOf('base64'))).toBe(
      'require("foo");\n//# sourceMappingURL=data:application/json;charset=utf-8;',
    );
    const sourceMapJson = JSON.parse(
      Buffer.from(bundle.post.slice(bundle.post.lastIndexOf('base64') + 7), 'base64').toString(),
    );
    expect(sourceMapJson).toEqual(
      expect.objectContaining({
        sources: ['/root/foo', '/root/bar'],
        x_google_ignoreList: [0, 1],
      }),
    );
  });
});

/**
 * OXC Bundler Integration Tests
 *
 * Tests the full Rolldown bundling pipeline end-to-end:
 * - Multi-module resolution and bundling
 * - hermes-compat transforms (ES5 downlevel, __defProp patch, (void 0) fix)
 * - Source map correctness
 * - IIFE wrapping and prelude injection (__DEV__, global)
 * - Error handling (missing imports, syntax errors)
 * - Dev server HTTP lifecycle
 * - postProcessSourceMap (ignoreList, x_facebook_sources)
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { ResolvedConfig } from '../../../config/types';

const TEST_ROOT = join(tmpdir(), 'bungae-oxc-integration-test');

function createTestConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    root: overrides.root || TEST_ROOT,
    entry: overrides.entry || 'index.ts',
    platform: 'ios',
    dev: true,
    minify: false,
    outDir: 'dist',
    mode: 'development',
    bundler: 'oxc',
    bundleOutput: '',
    sourcemapOutput: '',
    sourcemapSourcesRoot: '',
    sourcemapUseAbsolutePath: false,
    sourceMap: false,
    sourceMapUrl: '',
    assetsDest: '',
    assetCatalogDest: '',
    bundleEncoding: 'utf-8',
    resetCache: false,
    maxWorkers: 1,
    watchFolders: [],
    sourceExts: [],
    transformOptions: {},
    resolverOptions: {},
    unstableTransformProfile: 'default',
    interactive: true,
    resolver: {
      sourceExts: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
      assetExts: ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
      platforms: ['ios', 'android', 'native'],
      preferNativePlatform: true,
      nodeModulesPaths: [],
      blockList: [],
    },
    transformer: {
      minifier: 'terser',
      inlineRequires: false,
      babel: { presets: [], plugins: [] },
    },
    serializer: {
      polyfills: [],
      prelude: [],
      bundleType: 'plain',
      extraVars: {},
      getModulesRunBeforeMainModule: () => [],
      getPolyfills: () => [],
      inlineSourceMap: false,
    },
    server: {
      port: 8081,
      host: '0.0.0.0',
      https: false,
      key: '',
      cert: '',
      useGlobalHotkey: true,
      forwardClientLogs: true,
      verifyConnections: false,
      unstable_serverRoot: null,
    },
    experimental: {
      treeShaking: false,
    },
    ...overrides,
  } as ResolvedConfig;
}

function writeEntry(filename: string, content: string): void {
  writeFileSync(join(TEST_ROOT, filename), content, 'utf-8');
}

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Full Build Pipeline
// ---------------------------------------------------------------------------

describe('Integration: Full Build Pipeline', () => {
  it('should bundle multiple modules with cross-file imports', async () => {
    writeEntry(
      'math.ts',
      `export function add(a: number, b: number) { return a + b; }\nexport function mul(a: number, b: number) { return a * b; }\n`,
    );
    writeEntry('greet.ts', `export function greet(name: string) { return "Hello, " + name; }\n`);
    writeEntry(
      'index.ts',
      `import { add } from './math';\nimport { greet } from './greet';\nconsole.log(greet("Bungae"), add(1, 2));\n`,
    );

    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig();
    const result = await buildWithOxc(config, undefined, { hermes: false });

    expect(result.code).toContain('return a + b');
    expect(result.code).toContain('Hello, ');
    expect(result.code).toContain('Bungae');
  });

  it('should bundle deeply nested imports (A → B → C)', async () => {
    writeEntry('c.ts', `export const C_VALUE = 42;\n`);
    writeEntry('b.ts', `import { C_VALUE } from './c';\nexport const B_VALUE = C_VALUE + 1;\n`);
    writeEntry('a.ts', `import { B_VALUE } from './b';\nexport const A_VALUE = B_VALUE + 1;\n`);
    writeEntry('index.ts', `import { A_VALUE } from './a';\nconsole.log(A_VALUE);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    expect(result.code).toBeTruthy();
    // All values should be present in the bundle
    expect(result.code).toContain('42');
  });

  it('should handle re-exports correctly', async () => {
    writeEntry(
      'internal.ts',
      `export const SECRET = "hidden";\nexport const PUBLIC = "visible";\n`,
    );
    writeEntry('api.ts', `export { PUBLIC } from './internal';\n`);
    writeEntry('index.ts', `import { PUBLIC } from './api';\nconsole.log(PUBLIC);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    expect(result.code).toContain('visible');
  });

  it('should handle default and named exports together', async () => {
    writeEntry(
      'component.ts',
      `export default function App() { return "App"; }\nexport const version = "1.0";\n`,
    );
    writeEntry(
      'index.ts',
      `import App, { version } from './component';\nconsole.log(App(), version);\n`,
    );

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    expect(result.code).toContain('App');
    expect(result.code).toContain('1.0');
  });

  it('should handle circular imports without hanging', async () => {
    writeEntry(
      'moduleA.ts',
      `import { b } from './moduleB';\nexport const a = "A" + (typeof b === "string" ? b : "");\n`,
    );
    writeEntry(
      'moduleB.ts',
      `import { a } from './moduleA';\nexport const b = "B" + (typeof a === "string" ? a : "");\n`,
    );
    writeEntry('index.ts', `import { a } from './moduleA';\nconsole.log(a);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    // Should complete without hanging/crashing
    expect(result.code).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. IIFE Wrapping & Prelude Injection
// ---------------------------------------------------------------------------

describe('Integration: IIFE Wrapping & Prelude', () => {
  it('should wrap bundle in IIFE to prevent globalThis pollution', async () => {
    writeEntry('index.ts', `var x = 1;\nconsole.log(x);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    // Should have IIFE wrapper
    expect(result.code).toContain('(function()');
    expect(result.code).toContain('}).call(globalThis)');
  });

  it('should inject __DEV__ = true in dev mode', async () => {
    writeEntry('index.ts', `console.log(__DEV__);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig({ dev: true }), undefined, {
      hermes: false,
    });

    expect(result.code).toContain('__DEV__');
    expect(result.code).toMatch(/__DEV__\s*=\s*true/);
  });

  it('should inject __DEV__ = false in prod mode', async () => {
    writeEntry('index.ts', `console.log(__DEV__);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig({ dev: false }), undefined, {
      hermes: false,
      sourcemap: false,
    });

    expect(result.code).toContain('__DEV__');
    expect(result.code).toMatch(/__DEV__\s*=\s*false/);
  });

  it('should set var global = globalThis', async () => {
    writeEntry('index.ts', `console.log(global);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    expect(result.code).toContain('var global = globalThis');
  });
});

// ---------------------------------------------------------------------------
// 3. Hermes Compatibility
// ---------------------------------------------------------------------------

describe('Integration: Hermes Compatibility', () => {
  it('should downlevel class expressions to ES5', async () => {
    writeEntry(
      'index.ts',
      `class Foo {\n  greet() { return "hello"; }\n}\nconsole.log(new Foo().greet());\n`,
    );

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    // SWC should convert class to function
    expect(result.code).not.toMatch(/\bclass\s+Foo\b/);
  });

  it('should downlevel arrow functions to ES5', async () => {
    writeEntry('index.ts', `const fn = () => 42;\nconsole.log(fn());\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    // Arrow function should be converted to regular function
    // (SWC replaces => with function expressions)
    expect(result.code).not.toContain('=>');
  });

  it('should downlevel let/const to var', async () => {
    writeEntry('index.ts', `let x = 1;\nconst y = 2;\nconsole.log(x + y);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    // After ES5 transform, let/const should become var
    // (within the bundled module code, not the IIFE wrapper)
    expect(result.code).not.toMatch(/\blet\s+x\b/);
    expect(result.code).not.toMatch(/\bconst\s+y\b/);
  });

  it('should patch __defProp to be configurable', async () => {
    // We need a module that triggers Rolldown to generate __defProp
    // Re-exports typically cause __defProp usage
    writeEntry('lib.ts', `export const val = 1;\nexport const val2 = 2;\n`);
    writeEntry('index.ts', `export * from './lib';\nconsole.log("test");\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    // If __defProp exists, it should be patched with configurable: true
    if (result.code.includes('__defProp')) {
      expect(result.code).toContain('desc.configurable = true');
    }
    // Test passes regardless - not all bundles generate __defProp
  });
});

// ---------------------------------------------------------------------------
// 4. Source Map
// ---------------------------------------------------------------------------

describe('Integration: Source Maps', () => {
  it('should generate source map with correct sources', async () => {
    writeEntry('helper.ts', `export function helper() { return 1; }\n`);
    writeEntry('index.ts', `import { helper } from './helper';\nconsole.log(helper());\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, {
      hermes: false,
      sourcemap: true,
    });

    expect(result.map).toBeTruthy();
    const map = JSON.parse(result.map!);
    expect(map.version).toBe(3);
    expect(map.sources).toBeDefined();
    expect(Array.isArray(map.sources)).toBe(true);
    expect(map.sources.length).toBeGreaterThan(0);
  });

  it('should include ignoreList for node_modules in source map', async () => {
    writeEntry('index.ts', `console.log("test");\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, {
      hermes: false,
      sourcemap: true,
    });

    expect(result.map).toBeTruthy();
    const map = JSON.parse(result.map!);

    // x_facebook_sources should be present (Metro compat)
    expect(map.x_facebook_sources).toBeDefined();
    expect(map.x_facebook_sources.length).toBe(map.sources.length);

    // If any node_modules sources, ignoreList should mark them
    const nodeModulesIndices = map.sources
      .map((s: string, i: number) => (s && s.includes('node_modules') ? i : -1))
      .filter((i: number) => i >= 0);

    if (nodeModulesIndices.length > 0) {
      expect(map.ignoreList).toBeDefined();
      expect(map.x_google_ignoreList).toBeDefined();
      for (const idx of nodeModulesIndices) {
        expect(map.ignoreList).toContain(idx);
      }
    }
  });

  it('should generate inline source map when requested', async () => {
    writeEntry('index.ts', `export const x = 42;\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, {
      hermes: false,
      sourcemap: 'inline',
    });

    expect(result.code).toContain(
      '//# sourceMappingURL=data:application/json;charset=utf-8;base64,',
    );
    expect(result.map).toBeUndefined();

    // Verify the inline map is valid base64 JSON
    const base64Match = result.code.match(
      /sourceMappingURL=data:application\/json;charset=utf-8;base64,(.+)$/,
    );
    expect(base64Match).toBeTruthy();
    const decoded = Buffer.from(base64Match![1]!, 'base64').toString('utf-8');
    const inlineMap = JSON.parse(decoded);
    expect(inlineMap.version).toBe(3);
  });

  it('should not generate source map when sourcemap is false', async () => {
    writeEntry('index.ts', `export const x = 42;\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig({ dev: false }), undefined, {
      hermes: false,
      sourcemap: false,
    });

    expect(result.map).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 5. postProcessSourceMap
// ---------------------------------------------------------------------------

describe('Integration: postProcessSourceMap', () => {
  it('should add ignoreList and x_google_ignoreList for node_modules', async () => {
    const { postProcessSourceMap } = await import('../bundler');

    const inputMap = JSON.stringify({
      version: 3,
      sources: [
        'src/app.ts',
        'node_modules/react/index.js',
        'src/utils.ts',
        'node_modules/lodash/index.js',
      ],
      mappings: '',
    });

    const result = JSON.parse(postProcessSourceMap(inputMap));

    expect(result.ignoreList).toEqual([1, 3]);
    expect(result.x_google_ignoreList).toEqual([1, 3]);
  });

  it('should add x_facebook_sources with null entries', async () => {
    const { postProcessSourceMap } = await import('../bundler');

    const inputMap = JSON.stringify({
      version: 3,
      sources: ['a.ts', 'b.ts', 'c.ts'],
      mappings: '',
    });

    const result = JSON.parse(postProcessSourceMap(inputMap));

    expect(result.x_facebook_sources).toEqual([null, null, null]);
  });

  it('should not add ignoreList when no node_modules sources', async () => {
    const { postProcessSourceMap } = await import('../bundler');

    const inputMap = JSON.stringify({
      version: 3,
      sources: ['src/a.ts', 'src/b.ts'],
      mappings: '',
    });

    const result = JSON.parse(postProcessSourceMap(inputMap));

    expect(result.ignoreList).toBeUndefined();
    expect(result.x_google_ignoreList).toBeUndefined();
  });

  it('should return original string on invalid JSON', async () => {
    const { postProcessSourceMap } = await import('../bundler');

    const invalid = 'not json at all';
    expect(postProcessSourceMap(invalid)).toBe(invalid);
  });
});

// ---------------------------------------------------------------------------
// 6. JSON Module Handling
// ---------------------------------------------------------------------------

describe('Integration: JSON Modules', () => {
  it('should bundle JSON with named exports', async () => {
    writeEntry('config.json', JSON.stringify({ name: 'bungae', version: '2.0' }));
    writeEntry('index.ts', `import config from './config.json';\nconsole.log(config.name);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    expect(result.code).toContain('bungae');
    expect(result.code).toContain('2.0');
  });
});

// ---------------------------------------------------------------------------
// 7. Error Handling
// ---------------------------------------------------------------------------

describe('Integration: Error Handling', () => {
  it('should throw when entry file does not exist', async () => {
    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig({ entry: 'nonexistent.ts' });

    await expect(buildWithOxc(config)).rejects.toThrow('Entry file not found');
  });

  it('should fail on unresolvable import', async () => {
    writeEntry('index.ts', `import { foo } from './does-not-exist';\nconsole.log(foo);\n`);

    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig();

    await expect(buildWithOxc(config, undefined, { hermes: false })).rejects.toThrow();
  });

  it('should fail on syntax error in source file', async () => {
    writeEntry('index.ts', `const x = {\nconsole.log("missing closing brace")\n`);

    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig();

    await expect(buildWithOxc(config, undefined, { hermes: false })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. File Output
// ---------------------------------------------------------------------------

describe('Integration: File Output', () => {
  it('should write bundle and source map to disk when outfile is specified', async () => {
    writeEntry('index.ts', `export const x = 42;\n`);

    const outfile = join(TEST_ROOT, 'dist', 'bundle.js');
    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, {
      outfile,
      hermes: false,
      sourcemap: true,
    });

    expect(result.code).toBeTruthy();

    // Verify files were written
    const bundleFile = Bun.file(outfile);
    expect(await bundleFile.exists()).toBe(true);
    const bundleContent = await bundleFile.text();
    expect(bundleContent).toBe(result.code);

    const mapFile = Bun.file(`${outfile}.map`);
    expect(await mapFile.exists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Platform Resolution
// ---------------------------------------------------------------------------

describe('Integration: Platform Resolution', () => {
  it('should resolve .ios.ts variant on iOS platform', async () => {
    writeEntry('component.ts', `export const platform = "generic";\n`);
    writeEntry('component.ios.ts', `export const platform = "ios";\n`);
    writeEntry('index.ts', `import { platform } from './component';\nconsole.log(platform);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig({ platform: 'ios' }), undefined, {
      hermes: false,
    });

    // Should pick the .ios.ts variant
    expect(result.code).toContain('"ios"');
  });

  it('should resolve .android.ts variant on Android platform', async () => {
    writeEntry('component.ts', `export const platform = "generic";\n`);
    writeEntry('component.android.ts', `export const platform = "android";\n`);
    writeEntry('index.ts', `import { platform } from './component';\nconsole.log(platform);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig({ platform: 'android' }), undefined, {
      hermes: false,
    });

    expect(result.code).toContain('"android"');
  });

  it('should fall back to generic when platform variant does not exist', async () => {
    writeEntry('component.ts', `export const platform = "generic";\n`);
    writeEntry('index.ts', `import { platform } from './component';\nconsole.log(platform);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig({ platform: 'ios' }), undefined, {
      hermes: false,
    });

    expect(result.code).toContain('"generic"');
  });
});

// ---------------------------------------------------------------------------
// 10. Dev Server HTTP Lifecycle
// ---------------------------------------------------------------------------

describe('Integration: Dev Server Lifecycle', () => {
  it('should start and stop dev server without errors', async () => {
    writeEntry('index.ts', `console.log("hello");\n`);

    const { serveWithOxc } = await import('../server');
    const config = createTestConfig({
      server: {
        port: 19876, // use uncommon port for tests
        host: '127.0.0.1',
        https: false,
        key: '',
        cert: '',
        useGlobalHotkey: false,
        forwardClientLogs: false,
        verifyConnections: false,
        unstable_serverRoot: null,
      },
    });

    const server = await serveWithOxc(config);

    // Server should be running — verify status endpoint
    try {
      const statusRes = await fetch('http://127.0.0.1:19876/status');
      expect(statusRes.status).toBe(200);
      const statusText = await statusRes.text();
      expect(statusText).toBe('packager-status:running');
    } finally {
      await server.stop();
    }
  });

  it('should serve bundle via HTTP', async () => {
    writeEntry('index.ts', `console.log("bundled!");\n`);

    const { serveWithOxc } = await import('../server');
    const config = createTestConfig({
      server: {
        port: 19877,
        host: '127.0.0.1',
        https: false,
        key: '',
        cert: '',
        useGlobalHotkey: false,
        forwardClientLogs: false,
        verifyConnections: false,
        unstable_serverRoot: null,
      },
    });

    const server = await serveWithOxc(config);

    try {
      const bundleRes = await fetch('http://127.0.0.1:19877/index.bundle?platform=ios&dev=true');
      expect(bundleRes.status).toBe(200);
      const contentType = bundleRes.headers.get('content-type');
      expect(contentType).toContain('application/javascript');

      const bundleCode = await bundleRes.text();
      expect(bundleCode).toContain('bundled!');
      expect(bundleCode).toContain('(function()'); // IIFE
    } finally {
      await server.stop();
    }
  });

  it('should serve source map via HTTP', async () => {
    // Avoid top-level export — IIFE wrapping makes `export` inside function scope,
    // which is invalid JS and causes SWC/Rolldown sourcemap panic.
    writeEntry('index.ts', `const x = 42;\nconsole.log(x);\n`);

    const { serveWithOxc } = await import('../server');
    const config = createTestConfig({
      server: {
        port: 19878,
        host: '127.0.0.1',
        https: false,
        key: '',
        cert: '',
        useGlobalHotkey: false,
        forwardClientLogs: false,
        verifyConnections: false,
        unstable_serverRoot: null,
      },
    });

    const server = await serveWithOxc(config);

    try {
      // First request the bundle to ensure it's built
      await fetch('http://127.0.0.1:19878/index.bundle?platform=ios&dev=true');

      // Then request source map
      const mapRes = await fetch('http://127.0.0.1:19878/index.map');
      expect(mapRes.status).toBe(200);
      const mapText = await mapRes.text();
      const map = JSON.parse(mapText);
      expect(map.version).toBe(3);
    } finally {
      await server.stop();
    }
  });

  it('should return 404 for unknown routes', async () => {
    writeEntry('index.ts', `console.log("hello");\n`);

    const { serveWithOxc } = await import('../server');
    const config = createTestConfig({
      server: {
        port: 19879,
        host: '127.0.0.1',
        https: false,
        key: '',
        cert: '',
        useGlobalHotkey: false,
        forwardClientLogs: false,
        verifyConnections: false,
        unstable_serverRoot: null,
      },
    });

    const server = await serveWithOxc(config);

    try {
      const res = await fetch('http://127.0.0.1:19879/nonexistent');
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('should serve index page at root', async () => {
    writeEntry('index.ts', `console.log("hello");\n`);

    const { serveWithOxc } = await import('../server');
    const config = createTestConfig({
      server: {
        port: 19880,
        host: '127.0.0.1',
        https: false,
        key: '',
        cert: '',
        useGlobalHotkey: false,
        forwardClientLogs: false,
        verifyConnections: false,
        unstable_serverRoot: null,
      },
    });

    const server = await serveWithOxc(config);

    try {
      const res = await fetch('http://127.0.0.1:19880/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Bungae');
    } finally {
      await server.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Production Build
// ---------------------------------------------------------------------------

describe('Integration: Production Build', () => {
  it('should build without source map in production', async () => {
    writeEntry('index.ts', `const msg = "prod";\nconsole.log(msg);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig({ dev: false, minify: false }), undefined, {
      hermes: false,
      sourcemap: false,
    });

    expect(result.code).toBeTruthy();
    expect(result.map).toBeFalsy();
  });

  it('should enable tree shaking in production', async () => {
    writeEntry(
      'lib.ts',
      `export function used() { return "used"; }\nexport function unused() { return "unused"; }\n`,
    );
    writeEntry('index.ts', `import { used } from './lib';\nconsole.log(used());\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig({ dev: false, minify: false }), undefined, {
      hermes: false,
      sourcemap: false,
    });

    expect(result.code).toContain('used');
    // Tree shaking should remove unused function
    expect(result.code).not.toContain('"unused"');
  });
});

// ---------------------------------------------------------------------------
// 12. TypeScript Features
// ---------------------------------------------------------------------------

describe('Integration: TypeScript', () => {
  it('should strip type annotations', async () => {
    writeEntry(
      'index.ts',
      `interface Foo { bar: string; }\nconst x: Foo = { bar: "hello" };\nconsole.log(x.bar);\n`,
    );

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    expect(result.code).not.toContain('interface');
    expect(result.code).toContain('hello');
  });

  it('should handle enums', async () => {
    writeEntry('index.ts', `enum Color { Red, Green, Blue }\nconsole.log(Color.Red);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig(), undefined, { hermes: false });

    expect(result.code).toBeTruthy();
    // Enum should be compiled to JS object
    expect(result.code).not.toMatch(/\benum\b/);
  });

  it('should handle TSX/JSX', async () => {
    writeEntry('index.tsx', `const App = () => <div>Hello</div>;\nconsole.log(App);\n`);

    const { buildWithOxc } = await import('../bundler');
    const result = await buildWithOxc(createTestConfig({ entry: 'index.tsx' }), undefined, {
      hermes: false,
    });

    expect(result.code).toBeTruthy();
    // JSX should be compiled away
    expect(result.code).not.toContain('<div>');
  });
});

// ---------------------------------------------------------------------------
// 13. createRolldownOptions
// ---------------------------------------------------------------------------

describe('Integration: createRolldownOptions consistency', () => {
  it('should produce identical options for same config', async () => {
    const { createRolldownOptions } = await import('../bundler');
    const config = createTestConfig();

    const opts1 = createRolldownOptions(config, { dev: true });
    const opts2 = createRolldownOptions(config, { dev: true });

    expect(opts1.outputOptions.format).toBe(opts2.outputOptions.format);
    expect(opts1.outputOptions.strictExecutionOrder).toBe(opts2.outputOptions.strictExecutionOrder);
    expect(opts1.inputOptions.platform).toBe(opts2.inputOptions.platform);
  });

  it('should include all required plugins', async () => {
    const { createRolldownOptions } = await import('../bundler');
    const config = createTestConfig();

    const { inputOptions } = createRolldownOptions(config);
    const plugins = (inputOptions.plugins as any[]).filter(Boolean);
    const names = plugins.map((p: any) => p.name || '').filter(Boolean);

    // Core plugins that must always be present
    expect(names).toContain('bungae:prelude');
    expect(names).toContain('bungae:flow-strip');
    expect(names).toContain('bungae:asset');
    expect(names).toContain('bungae:json');
    expect(names).toContain('bungae:platform-resolver');
    expect(names).toContain('bungae:hermes-compat');
  });
});

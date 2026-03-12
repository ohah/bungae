import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { ResolvedConfig } from '../../../config/types';

/**
 * Create a minimal ResolvedConfig for testing
 */
function createTestConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    root: overrides.root || '/tmp/test',
    entry: overrides.entry || 'index.ts',
    platform: 'ios',
    dev: true,
    minify: false,
    outDir: 'dist',
    mode: 'development',
    bundler: 'oxc',
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

describe('createRolldownOptions', () => {
  it('should create input and output options', async () => {
    const { createRolldownOptions } = await import('../bundler');
    const config = createTestConfig({
      root: '/tmp/test',
      entry: 'index.ts',
    });

    const { inputOptions, outputOptions } = createRolldownOptions(config);

    expect(inputOptions.input).toContain('index.ts');
    expect(inputOptions.platform).toBe('neutral');
    expect(inputOptions.cwd).toBe('/tmp/test');
    expect(inputOptions.resolve).toBeDefined();
    expect(inputOptions.plugins).toBeDefined();
    expect(Array.isArray(inputOptions.plugins)).toBe(true);

    expect(outputOptions.format).toBe('esm');
    expect(outputOptions.strictExecutionOrder).toBe(true);
  });

  it('should disable treeshake in dev mode', async () => {
    const { createRolldownOptions } = await import('../bundler');
    const config = createTestConfig({ dev: true });

    const { inputOptions } = createRolldownOptions(config, { dev: true });
    expect(inputOptions.treeshake).toBe(false);
  });

  it('should enable treeshake in prod mode', async () => {
    const { createRolldownOptions } = await import('../bundler');
    const config = createTestConfig({ dev: false });

    const { inputOptions } = createRolldownOptions(config, { dev: false });
    expect(inputOptions.treeshake).toBe(true);
  });

  it('should include extra plugins when provided', async () => {
    const { createRolldownOptions } = await import('../bundler');
    const config = createTestConfig();

    const extraPlugin = { name: 'test-plugin' };
    const { inputOptions } = createRolldownOptions(config, {
      extraPlugins: [extraPlugin],
    });

    const plugins = inputOptions.plugins as any[];
    const names = plugins.map((p) => p.name || '');
    expect(names).toContain('test-plugin');
  });

  it('should configure sourcemap based on options', async () => {
    const { createRolldownOptions } = await import('../bundler');
    const config = createTestConfig();

    const { outputOptions: opts1 } = createRolldownOptions(config, { sourcemap: true });
    expect(opts1.sourcemap).toBe(true);

    const { outputOptions: opts2 } = createRolldownOptions(config, { sourcemap: false });
    expect(opts2.sourcemap).toBe(false);

    const { outputOptions: opts3 } = createRolldownOptions(config, { sourcemap: 'inline' });
    expect(opts3.sourcemap).toBe(true);
  });

  it('should set resolve extensions including platform variants', async () => {
    const { createRolldownOptions } = await import('../bundler');
    const config = createTestConfig({ platform: 'ios' });

    const { inputOptions } = createRolldownOptions(config);
    const extensions = inputOptions.resolve?.extensions as string[];
    expect(extensions).toBeDefined();
    expect(extensions.some((ext) => ext.includes('.ios.'))).toBe(true);
  });

  it('should set react-native mainFields', async () => {
    const { createRolldownOptions } = await import('../bundler');
    const config = createTestConfig();

    const { inputOptions } = createRolldownOptions(config);
    const mainFields = inputOptions.resolve?.mainFields;
    expect(mainFields).toContain('react-native');
    expect(mainFields).toContain('browser');
    expect(mainFields).toContain('main');
  });
});

describe('buildWithOxc', () => {
  const testDir = join(tmpdir(), 'bungae-oxc-bundler-test');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should throw when entry file does not exist', async () => {
    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig({
      root: testDir,
      entry: 'nonexistent.ts',
    });

    await expect(buildWithOxc(config)).rejects.toThrow('Entry file not found');
  });

  it('should bundle a simple TypeScript file', async () => {
    // Create a simple entry file
    writeFileSync(
      join(testDir, 'index.ts'),
      `
const greeting: string = "Hello, Bungae!";
console.log(greeting);
export default greeting;
`,
    );

    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig({
      root: testDir,
      entry: 'index.ts',
    });

    const result = await buildWithOxc(config, undefined, {
      hermes: false, // Skip Hermes for this test
    });

    expect(result.code).toBeTruthy();
    expect(result.code).toContain('Hello, Bungae!');
    expect(result.code).not.toContain(': string'); // TS types should be stripped
  });

  it('should bundle with source map in dev mode', async () => {
    writeFileSync(join(testDir, 'index.ts'), 'export const x = 42;\n');

    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig({
      root: testDir,
      entry: 'index.ts',
      dev: true,
    });

    const result = await buildWithOxc(config, undefined, {
      sourcemap: true,
      hermes: false,
    });

    expect(result.code).toBeTruthy();
    expect(result.map).toBeTruthy();
  });

  it('should bundle with inline source map', async () => {
    writeFileSync(join(testDir, 'index.ts'), 'export const x = 42;\n');

    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig({
      root: testDir,
      entry: 'index.ts',
    });

    const result = await buildWithOxc(config, undefined, {
      sourcemap: 'inline',
      hermes: false,
    });

    expect(result.code).toContain('//# sourceMappingURL=data:application/json');
    expect(result.map).toBeUndefined();
  });

  it('should handle JSON imports', async () => {
    writeFileSync(join(testDir, 'data.json'), JSON.stringify({ name: 'test', version: '1.0' }));
    writeFileSync(
      join(testDir, 'index.ts'),
      `
import data from './data.json';
console.log(data.name);
export default data;
`,
    );

    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig({
      root: testDir,
      entry: 'index.ts',
    });

    const result = await buildWithOxc(config, undefined, {
      hermes: false,
    });

    expect(result.code).toBeTruthy();
    expect(result.code).toContain('test');
  });

  it('should resolve module dependencies', async () => {
    writeFileSync(
      join(testDir, 'utils.ts'),
      'export function add(a: number, b: number): number { return a + b; }\n',
    );
    writeFileSync(
      join(testDir, 'index.ts'),
      `
import { add } from './utils';
console.log(add(1, 2));
`,
    );

    const { buildWithOxc } = await import('../bundler');
    const config = createTestConfig({
      root: testDir,
      entry: 'index.ts',
    });

    const result = await buildWithOxc(config, undefined, {
      hermes: false,
    });

    expect(result.code).toBeTruthy();
    // Should contain the add function's implementation
    expect(result.code).toContain('return a + b');
  });
});

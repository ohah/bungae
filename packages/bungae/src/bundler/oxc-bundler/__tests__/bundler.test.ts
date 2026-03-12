import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
    writeFileSync(
      join(testDir, 'index.ts'),
      'export const x = 42;\n',
    );

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
    writeFileSync(
      join(testDir, 'index.ts'),
      'export const x = 42;\n',
    );

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
    writeFileSync(
      join(testDir, 'data.json'),
      JSON.stringify({ name: 'test', version: '1.0' }),
    );
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

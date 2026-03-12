import { describe, expect, it } from 'bun:test';

import { OxcDevEngine } from '../../hmr/dev-engine';

describe('OxcDevEngine', () => {
  it('should instantiate with config and options', () => {
    const config = {
      root: '/tmp/test',
      entry: 'index.js',
      platform: 'ios',
      dev: true,
      minify: false,
      bundler: 'oxc' as const,
      resolver: {
        sourceExts: ['tsx', 'ts', 'jsx', 'js'],
        assetExts: ['png', 'jpg'],
        nodeModulesPaths: [],
      },
      server: { port: 8081 },
    };

    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });
    expect(engine).toBeDefined();
    expect(engine.listenerCount('buildDone')).toBe(0);
  });

  it('should support buildDone event listeners', () => {
    const config = {
      root: '/tmp/test',
      entry: 'index.js',
      platform: 'ios',
      dev: true,
      minify: false,
      bundler: 'oxc' as const,
      resolver: {
        sourceExts: ['tsx', 'ts', 'jsx', 'js'],
        assetExts: ['png', 'jpg'],
        nodeModulesPaths: [],
      },
    };

    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    let buildResult: any = null;
    engine.on('buildDone', (result) => {
      buildResult = result;
    });

    expect(engine.listenerCount('buildDone')).toBe(1);

    engine.emit('buildDone', { code: 'var x = 1;', map: undefined });
    expect(buildResult).toBeDefined();
    expect(buildResult.code).toBe('var x = 1;');
  });

  it('should support buildFailed event', () => {
    const config = {
      root: '/tmp/test',
      entry: 'index.js',
      platform: 'ios',
      dev: true,
      minify: false,
      bundler: 'oxc' as const,
      resolver: {
        sourceExts: ['tsx', 'ts', 'jsx', 'js'],
        assetExts: ['png', 'jpg'],
        nodeModulesPaths: [],
      },
    };

    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    let errorReceived: Error | null = null;
    engine.on('buildFailed', (err) => {
      errorReceived = err;
    });

    const testError = new Error('Build failed: syntax error');
    (engine as any).emit('buildFailed', testError);
    expect(errorReceived!).toBe(testError);
  });

  it('should support watchChange event', () => {
    const config = {
      root: '/tmp/test',
      entry: 'index.js',
      platform: 'ios',
      dev: true,
      minify: false,
      bundler: 'oxc' as const,
      resolver: {
        sourceExts: ['tsx', 'ts', 'jsx', 'js'],
        assetExts: ['png', 'jpg'],
        nodeModulesPaths: [],
      },
    };

    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    let changedFile: string | null = null;
    engine.on('watchChange', (file) => {
      changedFile = file;
    });

    (engine as any).emit('watchChange', 'App.tsx');
    expect(changedFile!).toBe('App.tsx');
  });

  it('should have no-op registerModules and removeClient', async () => {
    const config = {
      root: '/tmp/test',
      entry: 'index.js',
      platform: 'ios',
      dev: true,
      minify: false,
      bundler: 'oxc' as const,
      resolver: {
        sourceExts: ['tsx', 'ts', 'jsx', 'js'],
        assetExts: ['png', 'jpg'],
        nodeModulesPaths: [],
      },
    };

    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    // These should not throw
    await engine.registerModules('client-0', ['./App.tsx']);
    await engine.removeClient('client-0');
  });
});

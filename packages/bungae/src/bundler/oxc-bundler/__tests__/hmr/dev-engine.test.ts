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

  it('should support event listeners', () => {
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

    let buildDoneCalled = false;
    engine.on('buildDone', () => {
      buildDoneCalled = true;
    });

    expect(engine.listenerCount('buildDone')).toBe(1);

    // Manually emit to test
    engine.emit('buildDone', { code: 'test', map: undefined });
    expect(buildDoneCalled).toBe(true);
  });

  it('should handle buildFailed events', () => {
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
    engine.emit('buildFailed', testError);
    expect(errorReceived).toBe(testError);
  });

  it('should handle hmrUpdates events', () => {
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

    let receivedUpdates: any[] = [];
    engine.on('hmrUpdates', (updates) => {
      receivedUpdates = updates;
    });

    const updates = [
      {
        clientId: 'client-0',
        update: { type: 'Patch' as const, code: 'console.log("updated")', filename: 'App.tsx' },
      },
    ];
    engine.emit('hmrUpdates', updates);
    expect(receivedUpdates).toHaveLength(1);
    expect(receivedUpdates[0].update.type).toBe('Patch');
  });
});

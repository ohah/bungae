import { describe, expect, it } from 'bun:test';

import { OxcDevEngine } from '../../hmr/dev-engine';
import type { HMRUpdateResult } from '../../hmr/types';

function createTestConfig(overrides: Record<string, any> = {}) {
  return {
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
    ...overrides,
  };
}

describe('OxcDevEngine', () => {
  it('should instantiate with config and options', () => {
    const config = createTestConfig();
    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });
    expect(engine).toBeDefined();
    expect(engine.listenerCount('buildDone')).toBe(0);
  });

  it('should support buildDone event listeners', () => {
    const config = createTestConfig();
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
    const config = createTestConfig();
    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    let errorReceived: Error | null = null;
    engine.on('buildFailed', (err) => {
      errorReceived = err;
    });

    const testError = new Error('Build failed: syntax error');
    engine.emit('buildFailed', testError);
    expect(errorReceived!).toBe(testError);
  });

  it('should support watchChange event', () => {
    const config = createTestConfig();
    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    let changedFile: string | null = null;
    engine.on('watchChange', (file) => {
      changedFile = file;
    });

    engine.emit('watchChange', 'App.tsx');
    expect(changedFile!).toBe('App.tsx');
  });

  it('should support hmrUpdate event with Patch updates', () => {
    const config = createTestConfig();
    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    let receivedResult: HMRUpdateResult | null = null;
    engine.on('hmrUpdate', (result) => {
      receivedResult = result;
    });

    const mockResult: HMRUpdateResult = {
      updates: [
        {
          clientId: 'client-0',
          update: {
            type: 'Patch',
            code: 'console.log("updated")',
            filename: 'App.tsx',
            hmrBoundaries: [],
          },
        },
      ],
      changedFiles: ['App.tsx'],
    };

    engine.emit('hmrUpdate', mockResult);
    expect(receivedResult).toBeDefined();
    expect(receivedResult!.updates).toHaveLength(1);
    expect(receivedResult!.updates[0]!.update.type).toBe('Patch');
    expect(receivedResult!.changedFiles).toEqual(['App.tsx']);
  });

  it('should support hmrUpdate event with FullReload updates', () => {
    const config = createTestConfig();
    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    let receivedResult: HMRUpdateResult | null = null;
    engine.on('hmrUpdate', (result) => {
      receivedResult = result;
    });

    const mockResult: HMRUpdateResult = {
      updates: [
        {
          clientId: 'client-0',
          update: {
            type: 'FullReload',
            reason: 'non-component change',
          },
        },
      ],
      changedFiles: ['utils.ts'],
    };

    engine.emit('hmrUpdate', mockResult);
    expect(receivedResult).toBeDefined();
    expect(receivedResult!.updates[0]!.update.type).toBe('FullReload');
  });

  it('should support hmrUpdate event with Noop updates', () => {
    const config = createTestConfig();
    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    let receivedResult: HMRUpdateResult | null = null;
    engine.on('hmrUpdate', (result) => {
      receivedResult = result;
    });

    const mockResult: HMRUpdateResult = {
      updates: [
        {
          clientId: 'client-0',
          update: { type: 'Noop' },
        },
      ],
      changedFiles: ['styles.css'],
    };

    engine.emit('hmrUpdate', mockResult);
    expect(receivedResult).toBeDefined();
    expect(receivedResult!.updates[0]!.update.type).toBe('Noop');
  });

  it('should clean up listeners on close', async () => {
    const config = createTestConfig();
    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    engine.on('buildDone', () => {});
    engine.on('hmrUpdate', () => {});
    engine.on('buildFailed', () => {});

    expect(engine.listenerCount('buildDone')).toBe(1);
    expect(engine.listenerCount('hmrUpdate')).toBe(1);

    await engine.close();

    expect(engine.listenerCount('buildDone')).toBe(0);
    expect(engine.listenerCount('hmrUpdate')).toBe(0);
    expect(engine.listenerCount('buildFailed')).toBe(0);
  });

  it('should delegate registerModules and removeClient without errors', async () => {
    const config = createTestConfig();
    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    // Without a running engine, these should not throw
    await engine.registerModules('client-0', ['./App.tsx']);
    await engine.removeClient('client-0');
  });

  it('should return empty array from invalidate when engine is not running', async () => {
    const config = createTestConfig();
    const engine = new OxcDevEngine(config as any, { host: '0.0.0.0', port: 8081 });

    const result = await engine.invalidate('./App.tsx');
    expect(result).toEqual([]);
  });
});

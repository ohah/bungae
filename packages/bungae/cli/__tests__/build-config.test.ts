import { describe, test, expect } from 'bun:test';

import { buildConfigFromArgs } from '../build-config';
import type { ParsedArgs } from '../parse-args';

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: 'build',
    help: false,
    version: false,
    ...overrides,
  };
}

describe('buildConfigFromArgs', () => {
  // =============================================
  // Mode handling
  // =============================================
  describe('mode handling', () => {
    test('mode=release sets production + minify', () => {
      const config = buildConfigFromArgs(makeArgs({ mode: 'release' }));
      expect(config.mode).toBe('production');
      expect(config.dev).toBe(false);
      expect(config.minify).toBe(true);
    });

    test('mode=production sets dev=false', () => {
      const config = buildConfigFromArgs(makeArgs({ mode: 'production' }));
      expect(config.mode).toBe('production');
      expect(config.dev).toBe(false);
    });

    test('mode=production preserves explicit minify', () => {
      const config = buildConfigFromArgs(makeArgs({ mode: 'production', minify: true }));
      expect(config.minify).toBe(true);
    });

    test('mode=development sets dev=true, minify=false', () => {
      const config = buildConfigFromArgs(makeArgs({ mode: 'development' }));
      expect(config.mode).toBe('development');
      expect(config.dev).toBe(true);
      expect(config.minify).toBe(false);
    });

    test('no mode: serve defaults dev=true', () => {
      const config = buildConfigFromArgs(makeArgs({ command: 'serve' }));
      expect(config.dev).toBe(true);
    });

    test('no mode: start defaults dev=true', () => {
      const config = buildConfigFromArgs(makeArgs({ command: 'start' }));
      expect(config.dev).toBe(true);
    });

    test('no mode: build defaults dev=false', () => {
      const config = buildConfigFromArgs(makeArgs({ command: 'build' }));
      expect(config.dev).toBe(false);
    });

    test('explicit --dev overrides default', () => {
      const config = buildConfigFromArgs(makeArgs({ command: 'build', dev: true }));
      expect(config.dev).toBe(true);
    });
  });

  // =============================================
  // Server config mapping
  // =============================================
  describe('server config mapping', () => {
    test('maps host to server.host', () => {
      const config = buildConfigFromArgs(makeArgs({ host: '0.0.0.0' }));
      expect(config.server?.host).toBe('0.0.0.0');
    });

    test('maps port to server.port', () => {
      const config = buildConfigFromArgs(makeArgs({ port: 9000 }));
      expect(config.server?.port).toBe(9000);
    });

    test('maps https/key/cert to server config', () => {
      const config = buildConfigFromArgs(
        makeArgs({ https: true, key: './key.pem', cert: './cert.pem' }),
      );
      expect(config.server?.https).toBe(true);
      expect(config.server?.key).toBe('./key.pem');
      expect(config.server?.cert).toBe('./cert.pem');
    });

    test('no server config when no server options', () => {
      const config = buildConfigFromArgs(makeArgs({}));
      expect(config.server).toBeUndefined();
    });
  });

  // =============================================
  // Build output options
  // =============================================
  describe('build output options', () => {
    test('maps bundleOutput', () => {
      const config = buildConfigFromArgs(makeArgs({ bundleOutput: './main.jsbundle' }));
      expect(config.bundleOutput).toBe('./main.jsbundle');
    });

    test('maps sourcemap options', () => {
      const config = buildConfigFromArgs(
        makeArgs({
          sourcemapOutput: './bundle.map',
          sourcemapSourcesRoot: '/src',
          sourcemapUseAbsolutePath: true,
        }),
      );
      expect(config.sourcemapOutput).toBe('./bundle.map');
      expect(config.sourcemapSourcesRoot).toBe('/src');
      expect(config.sourcemapUseAbsolutePath).toBe(true);
    });

    test('maps source-map to sourceMap', () => {
      const config = buildConfigFromArgs(makeArgs({ sourcemap: true }));
      expect(config.sourceMap).toBe(true);
    });

    test('maps assetsDest', () => {
      const config = buildConfigFromArgs(makeArgs({ assetsDest: './res' }));
      expect(config.assetsDest).toBe('./res');
    });

    test('maps assetCatalogDest', () => {
      const config = buildConfigFromArgs(makeArgs({ assetCatalogDest: './catalog' }));
      expect(config.assetCatalogDest).toBe('./catalog');
    });

    test('maps bundleEncoding', () => {
      const config = buildConfigFromArgs(makeArgs({ bundleEncoding: 'utf8' }));
      expect(config.bundleEncoding).toBe('utf8');
    });

    test('maps unstableTransformProfile', () => {
      const config = buildConfigFromArgs(makeArgs({ unstableTransformProfile: 'hermes-stable' }));
      expect(config.unstableTransformProfile).toBe('hermes-stable');
    });
  });

  // =============================================
  // Resolver config from CLI
  // =============================================
  describe('resolver config from CLI', () => {
    test('maps sourceExts to resolver.sourceExts with dot prefix', () => {
      const config = buildConfigFromArgs(makeArgs({ sourceExts: ['ts', 'tsx', '.js'] }));
      expect(config.resolver?.sourceExts).toEqual(['.ts', '.tsx', '.js']);
    });

    test('maps watchFolders to resolver.nodeModulesPaths', () => {
      const config = buildConfigFromArgs(makeArgs({ watchFolders: ['../shared', '../common'] }));
      expect(config.resolver?.nodeModulesPaths).toEqual(['../shared', '../common']);
    });

    test('no resolver config when no resolver options', () => {
      const config = buildConfigFromArgs(makeArgs({}));
      expect(config.resolver).toBeUndefined();
    });
  });

  // =============================================
  // Transform/Resolver options
  // =============================================
  describe('transform/resolver key-value options', () => {
    test('maps transformOption to transformOptions', () => {
      const config = buildConfigFromArgs(makeArgs({ transformOption: ['foo=bar', 'baz=qux'] }));
      expect(config.transformOptions).toEqual({ foo: 'bar', baz: 'qux' });
    });

    test('maps resolverOption to resolverOptions', () => {
      const config = buildConfigFromArgs(makeArgs({ resolverOption: ['key1=val1'] }));
      expect(config.resolverOptions).toEqual({ key1: 'val1' });
    });

    test('no transformOptions when not provided', () => {
      const config = buildConfigFromArgs(makeArgs({}));
      expect(config.transformOptions).toBeUndefined();
    });
  });

  // =============================================
  // Other options
  // =============================================
  describe('other options', () => {
    test('maps maxWorkers', () => {
      const config = buildConfigFromArgs(makeArgs({ maxWorkers: 4 }));
      expect(config.maxWorkers).toBe(4);
    });

    test('maps resetCache', () => {
      const config = buildConfigFromArgs(makeArgs({ resetCache: true }));
      expect(config.resetCache).toBe(true);
    });

    test('maps interactive', () => {
      const config = buildConfigFromArgs(makeArgs({ interactive: false }));
      expect(config.interactive).toBe(false);
    });

    test('maps bundler', () => {
      const config = buildConfigFromArgs(makeArgs({ bundler: 'graph' }));
      expect(config.bundler).toBe('graph');
    });

    test('maps platform', () => {
      const config = buildConfigFromArgs(makeArgs({ platform: 'android' }));
      expect(config.platform).toBe('android');
    });
  });
});

import { describe, test, expect } from 'bun:test';

import { getDefaultConfig, DEFAULT_RESOLVER } from '../defaults';

describe('Config Defaults', () => {
  test('should return default configuration', () => {
    const config = getDefaultConfig();

    expect(config.root).toBe(process.cwd());
    expect(config.entry).toBe('index.js');
    expect(config.platform).toBe('ios');
    expect(config.dev).toBe(false);
    expect(config.minify).toBe(false);
    expect(config.outDir).toBe('dist');
    expect(config.mode).toBe('production');
  });

  test('should use custom root directory', () => {
    const customRoot = '/custom/path';
    const config = getDefaultConfig(customRoot);

    expect(config.root).toBe(customRoot);
  });

  test('should have default resolver config', () => {
    const config = getDefaultConfig();

    expect(config.resolver.sourceExts).toEqual(DEFAULT_RESOLVER.sourceExts);
    expect(config.resolver.assetExts).toEqual(DEFAULT_RESOLVER.assetExts);
    expect(config.resolver.platforms).toEqual(DEFAULT_RESOLVER.platforms);
    expect(config.resolver.preferNativePlatform).toBe(true);
  });

  test('should have default transformer config', () => {
    const config = getDefaultConfig();

    expect(config.transformer.minifier).toBe('terser'); // Metro-compatible: Metro uses Terser by default
    expect(config.transformer.inlineRequires).toBe(false);
    expect(config.transformer.babel).toEqual({ presets: [], plugins: [] });
  });

  test('should have default serializer config', () => {
    const config = getDefaultConfig();

    expect(config.serializer.polyfills).toEqual([]);
    expect(config.serializer.prelude).toEqual([]);
    expect(config.serializer.bundleType).toBe('plain');
  });

  test('should have default server config with host, https, key, cert', () => {
    const config = getDefaultConfig();

    expect(config.server.port).toBe(8081);
    expect(config.server.host).toBe('localhost');
    expect(config.server.https).toBe(false);
    expect(config.server.key).toBe('');
    expect(config.server.cert).toBe('');
    expect(config.server.useGlobalHotkey).toBe(true);
    expect(config.server.forwardClientLogs).toBe(true);
  });

  test('should have default build output options', () => {
    const config = getDefaultConfig();

    expect(config.bundleOutput).toBe('');
    expect(config.sourcemapOutput).toBe('');
    expect(config.sourcemapSourcesRoot).toBe('');
    expect(config.sourcemapUseAbsolutePath).toBe(false);
    expect(config.sourceMap).toBe(false);
    expect(config.sourceMapUrl).toBe('');
    expect(config.assetsDest).toBe('');
    expect(config.assetCatalogDest).toBe('');
    expect(config.bundleEncoding).toBe('utf8');
    expect(config.resetCache).toBe(false);
    expect(config.maxWorkers).toBe(0);
    expect(config.watchFolders).toEqual([]);
    expect(config.sourceExts).toEqual([]);
    expect(config.transformOptions).toEqual({});
    expect(config.resolverOptions).toEqual({});
    expect(config.unstableTransformProfile).toBe('default');
    expect(config.interactive).toBe(true);
  });
});

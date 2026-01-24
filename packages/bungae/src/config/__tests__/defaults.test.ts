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

    expect(config.transformer.minifier).toBe('bun'); // Use 'bun' as default since it's always available
    expect(config.transformer.inlineRequires).toBe(false);
  });

  test('should have default serializer config', () => {
    const config = getDefaultConfig();

    expect(config.serializer.polyfills).toEqual([]);
    expect(config.serializer.prelude).toEqual([]);
    expect(config.serializer.bundleType).toBe('plain');
  });
});

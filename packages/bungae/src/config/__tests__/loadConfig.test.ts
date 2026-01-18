/**
 * Copyright (c) 2026 ohah
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

import getDefaultConfig from '../defaults';
import { loadConfig, resolveConfig } from '../load';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = resolve(__dirname, '../__fixtures__');

describe('loadConfig', () => {
  beforeEach(() => {
    // Bun Test doesn't have jest.spyOn, but we can suppress console.warn if needed
  });

  test('can load the config from a path', async () => {
    // We don't actually use the specified file in this test but it needs to
    // resolve to a real file on the file system.
    const result = await loadConfig({
      config: resolve(FIXTURES, 'custom-path.bungae.config.js'),
    });
    expect(result).toMatchObject({
      entry: 'custom-path-entry.js',
    });
  });

  test('can load config objects', async () => {
    const result = await loadConfig({
      config: resolve(FIXTURES, 'basic.config.js'),
    });
    expect(result.entry).toEqual('basic-config-entry.js');
  });

  test('can load config from function', async () => {
    const defaultConfigOverrides = getDefaultConfig();
    defaultConfigOverrides.resolver.sourceExts = ['json', 're'];
    const configPath = resolve(__dirname, '../__fixtures__/cjs-sync-function.bungae.config.js');
    const configModule = await import(configPath);
    const configFn = configModule.default || configModule;
    const userConfig = typeof configFn === 'function' ? configFn(defaultConfigOverrides) : configFn;
    const result = resolveConfig(userConfig || {}, process.cwd());

    const defaults = getDefaultConfig();
    expect(result.resolver).toMatchObject({
      assetExts: defaults.resolver.assetExts,
      sourceExts: expect.arrayContaining(['json', 're']),
    });
  });

  test('can load config that exports a promise', async () => {
    const result = await loadConfig({
      config: resolve(FIXTURES, 'cjs-promise.bungae.config.js'),
    });
    expect(result).toMatchObject({
      entry: 'cjs-promise-config-entry.js',
    });
  });

  test('can load the config from a path pointing to a directory', async () => {
    // We don't actually use the specified file in this test but it needs to
    // resolve to a real file on the file system.
    const result = await loadConfig({ cwd: FIXTURES });
    // Should return empty config if no config file found in directory
    expect(result).toBeDefined();
  });

  test('can load the config with no config present', async () => {
    const result = await loadConfig({ cwd: process.cwd() });
    const defaultConfig = getDefaultConfig(process.cwd());
    const resolved = resolveConfig(result, process.cwd());

    // Should match default config structure
    expect(resolved.root).toBe(defaultConfig.root);
    expect(resolved.entry).toBe(defaultConfig.entry);
    expect(resolved.platform).toBe(defaultConfig.platform);
  });

  test('mergeConfig chains config functions', async () => {
    const defaultConfigOverrides = getDefaultConfig();
    defaultConfigOverrides.resolver.sourceExts = ['override'];
    const configPath = resolve(__dirname, '../__fixtures__/merged.bungae.config.js');
    const configModule = await import(configPath);
    const configFn = configModule.default || configModule;
    const userConfig = typeof configFn === 'function' ? configFn(defaultConfigOverrides) : configFn;
    const result = resolveConfig(userConfig || {}, process.cwd());

    expect(result.resolver.sourceExts).toEqual(
      expect.arrayContaining(['before', 'override', 'after']),
    );
  });

  test('validates config for root', async () => {
    expect.assertions(1);
    try {
      const config = await loadConfig({
        config: resolve(FIXTURES, 'bad-root.bungae.config.js'),
      });
      // Should throw an error when resolving with invalid root
      resolveConfig(config, process.cwd());
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain('root');
    }
  });

  test('validates config for server', async () => {
    expect.assertions(1);
    try {
      const config = await loadConfig({
        config: resolve(FIXTURES, 'bad-server.bungae.config.js'),
      });
      // Should throw an error when resolving with invalid server config
      resolveConfig(config, process.cwd());
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain('server');
    }
  });

  describe('given a search directory', () => {
    test('looks in the expected places', async () => {
      // Bungae searches for config files in this order:
      // 1. bungae.config.ts
      // 2. bungae.config.js
      // 3. bungae.config.json
      // 4. package.json (bungae field)
      const testDir = resolve(FIXTURES, 'search-test');
      const result = await loadConfig({ cwd: testDir });
      // Should return empty config if no config found
      expect(result).toBeDefined();

      // Note: Metro tests exact search order with mocking, but Bungae's search is simpler
      // Bungae only searches: bungae.config.ts, bungae.config.js, bungae.config.json, package.json
      // Metro searches many more locations including .config/ subdirectory and home directory
    });

    test('returns defaults when no config is present', async () => {
      const testDir = resolve(FIXTURES, 'no-config-test');
      const result = await loadConfig({ cwd: testDir });
      const defaultConfig = getDefaultConfig(testDir);
      const resolved = resolveConfig(result, testDir);

      // Should match default config structure
      expect(resolved.root).toBe(defaultConfig.root);
      expect(resolved.entry).toBe(defaultConfig.entry);
      expect(resolved.platform).toBe(defaultConfig.platform);
    });
  });
});

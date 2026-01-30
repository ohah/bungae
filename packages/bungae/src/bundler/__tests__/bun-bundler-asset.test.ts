/**
 * Bun Bundler Asset Tests
 *
 * - assetPathsToAssetInfos, asset plugin
 * - buildWithBunTranspiler: 에셋 수집 및 dev/release별 에셋 개수
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveConfig, getDefaultConfig } from '../../config';
import { buildWithBunTranspiler } from '../bun-bundler';
import { assetPathsToAssetInfos } from '../bun-bundler/build/assets';

function createMinimalPNG(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
}

function setupMockAssetRegistry(testDir: string): void {
  const assetRegistryDir = join(testDir, 'node_modules', 'react-native', 'Libraries', 'Image');
  mkdirSync(assetRegistryDir, { recursive: true });
  writeFileSync(
    join(assetRegistryDir, 'AssetRegistry.js'),
    `module.exports = { registerAsset: (asset) => asset };`,
    'utf-8',
  );
}

describe('bun-bundler assetPathsToAssetInfos', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-bun-asset-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  test('should convert asset paths to AssetInfo[]', () => {
    const assetsDir = join(testDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    const iconPath = join(assetsDir, 'icon.png');
    writeFileSync(iconPath, createMinimalPNG());

    const config = resolveConfig(
      { ...getDefaultConfig(testDir), entry: 'index.js', platform: 'ios' },
      testDir,
    );
    const infos = assetPathsToAssetInfos(config, [{ path: iconPath, width: 1, height: 1 }]);

    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatchObject({
      name: 'icon',
      type: 'png',
      httpServerLocation: '/assets/assets',
      filePath: iconPath,
      scales: [1],
    });
    expect(infos[0]!.width).toBe(1);
    expect(infos[0]!.height).toBe(1);
  });

  test('should deduplicate paths', () => {
    const assetsDir = join(testDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    const iconPath = join(assetsDir, 'icon.png');
    writeFileSync(iconPath, createMinimalPNG());

    const config = resolveConfig(
      { ...getDefaultConfig(testDir), entry: 'index.js', platform: 'ios' },
      testDir,
    );
    const collected = [
      { path: iconPath, width: 1, height: 1 },
      { path: iconPath, width: 1, height: 1 },
    ];
    const infos = assetPathsToAssetInfos(config, collected);

    expect(infos).toHaveLength(1);
  });

  test('should skip non-asset extensions', () => {
    const jsPath = join(testDir, 'index.js');
    writeFileSync(jsPath, "console.log('hi');");

    const config = resolveConfig(
      { ...getDefaultConfig(testDir), entry: 'index.js', platform: 'ios' },
      testDir,
    );
    const infos = assetPathsToAssetInfos(config, [{ path: jsPath, width: 0, height: 0 }]);

    expect(infos).toHaveLength(0);
  });
});

describe('bun-bundler build assets', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-bun-build-asset-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    setupMockAssetRegistry(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  test('should include single required asset in build result', async () => {
    const assetsDir = join(testDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'icon.png'), createMinimalPNG());
    const entryFile = join(testDir, 'index.js');
    writeFileSync(
      entryFile,
      `const icon = require('./assets/icon.png');\nconsole.log(icon);`,
      'utf-8',
    );

    const config = resolveConfig(
      { ...getDefaultConfig(testDir), entry: 'index.js', platform: 'ios', dev: true },
      testDir,
    );
    const result = await buildWithBunTranspiler(config);

    expect(result.assets).toBeDefined();
    const assets = result.assets || [];
    expect(assets.length).toBe(1);
    expect(assets[0]!.name).toBe('icon');
    expect(assets[0]!.type).toBe('png');
    expect(result.code).toContain('__packager_asset');
  });

  test('dev build should include all assets (prod + dev-only in __DEV__ block)', async () => {
    const assetsDir = join(testDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'prod-icon.png'), createMinimalPNG());
    writeFileSync(join(assetsDir, 'dev-icon.png'), createMinimalPNG());
    const entryFile = join(testDir, 'index.js');
    writeFileSync(
      entryFile,
      `
const prodIcon = require('./assets/prod-icon.png');
if (__DEV__) {
  const devIcon = require('./assets/dev-icon.png');
  console.log('Dev icon:', devIcon);
}
console.log('Prod icon:', prodIcon);
`,
      'utf-8',
    );

    const devConfig = resolveConfig(
      { ...getDefaultConfig(testDir), entry: 'index.js', platform: 'ios', dev: true },
      testDir,
    );
    const devResult = await buildWithBunTranspiler(devConfig);

    expect(devResult.assets).toBeDefined();
    const devAssets = devResult.assets || [];
    expect(devAssets.length).toBe(2);
    const devNames = devAssets.map((a) => a.name);
    expect(devNames).toContain('prod-icon');
    expect(devNames).toContain('dev-icon');
  });

  test('release build should exclude assets inside __DEV__ block (fewer assets than dev)', async () => {
    const assetsDir = join(testDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'prod-icon.png'), createMinimalPNG());
    writeFileSync(join(assetsDir, 'dev-icon.png'), createMinimalPNG());
    const entryFile = join(testDir, 'index.js');
    writeFileSync(
      entryFile,
      `
const prodIcon = require('./assets/prod-icon.png');
if (__DEV__) {
  const devIcon = require('./assets/dev-icon.png');
  console.log('Dev icon:', devIcon);
}
console.log('Prod icon:', prodIcon);
`,
      'utf-8',
    );

    const releaseConfig = resolveConfig(
      { ...getDefaultConfig(testDir), entry: 'index.js', platform: 'ios', dev: false },
      testDir,
    );
    const releaseResult = await buildWithBunTranspiler(releaseConfig);

    expect(releaseResult.assets).toBeDefined();
    const releaseAssets = releaseResult.assets || [];
    const releaseNames = releaseAssets.map((a) => a.name);
    expect(releaseNames).toContain('prod-icon');
    expect(releaseNames).not.toContain('dev-icon');
    expect(releaseAssets.length).toBe(1);
  });

  test('release build should have fewer assets than dev when using __DEV__ && require', async () => {
    const assetsDir = join(testDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'prod-icon.png'), createMinimalPNG());
    writeFileSync(join(assetsDir, 'dev-icon.png'), createMinimalPNG());
    const entryFile = join(testDir, 'index.js');
    writeFileSync(
      entryFile,
      `
const prodIcon = require('./assets/prod-icon.png');
__DEV__ && require('./assets/dev-icon.png');
console.log('Prod icon:', prodIcon);
`,
      'utf-8',
    );

    const devConfig = resolveConfig(
      { ...getDefaultConfig(testDir), entry: 'index.js', platform: 'ios', dev: true },
      testDir,
    );
    const releaseConfig = resolveConfig(
      { ...getDefaultConfig(testDir), entry: 'index.js', platform: 'ios', dev: false },
      testDir,
    );

    const devResult = await buildWithBunTranspiler(devConfig);
    const releaseResult = await buildWithBunTranspiler(releaseConfig);

    const devCount = (devResult.assets || []).length;
    const releaseCount = (releaseResult.assets || []).length;
    expect(devCount).toBe(2);
    expect(releaseCount).toBe(1);
    expect(releaseCount).toBeLessThan(devCount);
  });
});

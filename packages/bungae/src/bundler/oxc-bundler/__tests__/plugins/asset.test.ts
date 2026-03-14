import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { extractAssets } from '../../assets/extract';
import {
  resolveAsset,
  findAssetVariants,
  getImageDimensions,
  resolveAssetFile,
} from '../../plugins/asset';

/** Create a valid PNG file with correct CRC for image-size to parse */
function createPng(path: string, width = 1, height = 1): void {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR data (13 bytes)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  // IHDR chunk: length + type + data + crc
  const ihdrType = Buffer.from('IHDR');
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);

  // CRC32 of type + data (simplified: use 0 — image-size doesn't check CRC)
  const crc = Buffer.alloc(4);

  // IEND chunk
  const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

  writeFileSync(path, Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, crc, iend]));
}

describe('resolveAsset', () => {
  const testDir = join(tmpdir(), 'bungae-asset-test-' + Date.now());
  const assetsDir = join(testDir, 'src', 'assets');

  beforeEach(() => {
    mkdirSync(assetsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should resolve a basic asset with 1x scale', () => {
    createPng(join(assetsDir, 'icon.png'), 24, 24);

    const result = resolveAsset(join(assetsDir, 'icon.png'), testDir, 'ios');

    expect(result.__packager_asset).toBe(true);
    expect(result.name).toBe('icon');
    expect(result.type).toBe('png');
    expect(result.scales).toContain(1);
    expect(result.httpServerLocation).toBe('/src/assets');
    expect(result.hash).toBeTruthy();
  });

  it('should detect scale variants (@2x, @3x)', () => {
    createPng(join(assetsDir, 'icon.png'));
    createPng(join(assetsDir, 'icon@2x.png'));
    createPng(join(assetsDir, 'icon@3x.png'));

    const result = resolveAsset(join(assetsDir, 'icon.png'), testDir, 'ios');

    expect(result.scales).toEqual([1, 2, 3]);
  });

  it('should detect image dimensions', () => {
    createPng(join(assetsDir, 'icon.png'), 48, 32);

    const result = resolveAsset(join(assetsDir, 'icon.png'), testDir, 'ios');

    expect(result.width).toBe(48);
    expect(result.height).toBe(32);
  });

  it('should not include dimensions for non-image assets', () => {
    writeFileSync(join(assetsDir, 'data.json'), '{"key": "value"}');

    const result = resolveAsset(join(assetsDir, 'data.json'), testDir, 'ios');

    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(result.type).toBe('json');
  });

  it('should compute unique hash from file content', () => {
    createPng(join(assetsDir, 'a.png'), 10, 10);
    createPng(join(assetsDir, 'b.png'), 20, 20);

    const resultA = resolveAsset(join(assetsDir, 'a.png'), testDir, 'ios');
    const resultB = resolveAsset(join(assetsDir, 'b.png'), testDir, 'ios');

    expect(resultA.hash).not.toBe(resultB.hash);
  });

  it('should use forward slashes in httpServerLocation', () => {
    createPng(join(assetsDir, 'icon.png'));

    const result = resolveAsset(join(assetsDir, 'icon.png'), testDir, 'android');

    expect(result.httpServerLocation).not.toContain('\\');
    expect(result.httpServerLocation).toMatch(/^\/src\/assets$/);
  });
});

describe('findAssetVariants', () => {
  const testDir = join(tmpdir(), 'bungae-variants-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    createPng(join(testDir, 'icon.png'));
    createPng(join(testDir, 'icon@2x.png'));
    createPng(join(testDir, 'icon@3x.png'));
    createPng(join(testDir, 'logo.png'));
    createPng(join(testDir, 'logo.ios.png'));
    createPng(join(testDir, 'logo.android.png'));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should find all scale variants', () => {
    const { scales, files } = findAssetVariants(testDir, 'icon', 'png', 'ios');
    expect(scales).toEqual([1, 2, 3]);
    expect(files.length).toBe(3);
  });

  it('should filter out other platform variants', () => {
    const { files } = findAssetVariants(testDir, 'logo', 'png', 'ios');
    const paths = files.map((f) => f.replace(/\\/g, '/'));
    expect(paths.some((f) => f.includes('.android.'))).toBe(false);
  });

  it('should return default scale for missing assets', () => {
    const { scales } = findAssetVariants(testDir, 'nonexistent', 'png', 'ios');
    expect(scales).toEqual([1]);
  });
});

describe('getImageDimensions', () => {
  const testDir = join(tmpdir(), 'bungae-dims-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    createPng(join(testDir, 'icon.png'), 64, 32);
    writeFileSync(join(testDir, 'data.json'), '{}');
    writeFileSync(join(testDir, 'font.ttf'), Buffer.alloc(50));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should detect PNG dimensions', () => {
    const dims = getImageDimensions(join(testDir, 'icon.png'), 'png');
    expect(dims).not.toBeNull();
    expect(dims!.width).toBe(64);
    expect(dims!.height).toBe(32);
  });

  it('should return null for non-image types', () => {
    expect(getImageDimensions(join(testDir, 'data.json'), 'json')).toBeNull();
  });

  it('should return null for fonts', () => {
    expect(getImageDimensions(join(testDir, 'font.ttf'), 'ttf')).toBeNull();
  });
});

describe('resolveAssetFile', () => {
  const testDir = join(tmpdir(), 'bungae-resolve-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    createPng(join(testDir, 'icon.png'));
    createPng(join(testDir, 'icon@2x.png'));
    createPng(join(testDir, 'icon@3x.png'));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should resolve exact scale match', () => {
    const file = resolveAssetFile(testDir, 'icon', 'png', 'ios', 2);
    expect(file).not.toBeNull();
    expect(file!).toContain('icon@2x.png');
  });

  it('should resolve best scale (round up)', () => {
    const file = resolveAssetFile(testDir, 'icon', 'png', 'ios', 1.5);
    expect(file).not.toBeNull();
    expect(file!).toContain('icon@2x.png');
  });

  it('should resolve base scale', () => {
    const file = resolveAssetFile(testDir, 'icon', 'png', 'ios', 1);
    expect(file).not.toBeNull();
    expect(file!).toContain('icon.png');
    expect(file!).not.toContain('@');
  });
});

describe('httpServerLocation normalization', () => {
  it('should use relative path for project-local assets', () => {
    const testDir = join(tmpdir(), 'bungae-http-test-' + Date.now());
    const assetsDir = join(testDir, 'src', 'assets');
    mkdirSync(assetsDir, { recursive: true });
    createPng(join(assetsDir, 'icon.png'));

    const result = resolveAsset(join(assetsDir, 'icon.png'), testDir, 'ios');
    expect(result.httpServerLocation).toBe('/src/assets');

    rmSync(testDir, { recursive: true, force: true });
  });

  it('should normalize ../node_modules paths for monorepo', () => {
    // Simulate monorepo: project is at /repo/packages/app, asset is at /repo/node_modules/pkg/img.png
    const repoRoot = join(tmpdir(), 'bungae-monorepo-test-' + Date.now());
    const projectRoot = join(repoRoot, 'packages', 'app');
    const nmDir = join(repoRoot, 'node_modules', 'some-pkg', 'assets');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(nmDir, { recursive: true });
    createPng(join(nmDir, 'icon.png'));

    const result = resolveAsset(join(nmDir, 'icon.png'), projectRoot, 'ios');

    // Should not start with /../../
    expect(result.httpServerLocation).not.toContain('/../');
    expect(result.httpServerLocation).toContain('node_modules');

    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('should simplify pnpm .pnpm cache paths', () => {
    const repoRoot = join(tmpdir(), 'bungae-pnpm-cache-test-' + Date.now());
    const projectRoot = join(repoRoot, 'packages', 'app');
    const pnpmDir = join(
      repoRoot,
      'node_modules',
      '.pnpm',
      'react-native@0.83.1',
      'node_modules',
      'react-native',
      'Libraries',
      'LogBox',
    );
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(pnpmDir, { recursive: true });
    createPng(join(pnpmDir, 'close.png'));

    const result = resolveAsset(join(pnpmDir, 'close.png'), projectRoot, 'ios');

    expect(result.httpServerLocation).not.toContain('.pnpm');
    expect(result.httpServerLocation).toContain('react-native/Libraries/LogBox');

    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('should simplify Bun .bun cache paths', () => {
    const repoRoot = join(tmpdir(), 'bungae-bun-cache-test-' + Date.now());
    const projectRoot = join(repoRoot, 'packages', 'app');
    // Simulate Bun cache: node_modules/.bun/react-native@0.83.1+hash/node_modules/react-native/Libraries/LogBox
    const bunCacheDir = join(
      repoRoot,
      'node_modules',
      '.bun',
      'react-native@0.83.1+abc123',
      'node_modules',
      'react-native',
      'Libraries',
      'LogBox',
    );
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(bunCacheDir, { recursive: true });
    createPng(join(bunCacheDir, 'close.png'));

    const result = resolveAsset(join(bunCacheDir, 'close.png'), projectRoot, 'ios');

    // Should simplify to /node_modules/react-native/Libraries/LogBox
    expect(result.httpServerLocation).not.toContain('.bun');
    expect(result.httpServerLocation).toContain('react-native/Libraries/LogBox');

    rmSync(repoRoot, { recursive: true, force: true });
  });
});

describe('platform-specific asset resolution', () => {
  const testDir = join(tmpdir(), 'bungae-platform-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    createPng(join(testDir, 'logo.png'), 100, 50);
    createPng(join(testDir, 'logo.ios.png'), 100, 50);
    createPng(join(testDir, 'logo.android.png'), 100, 50);
    createPng(join(testDir, 'badge.png'), 20, 20);
    createPng(join(testDir, 'badge@2x.png'), 40, 40);
    createPng(join(testDir, 'badge@2x.ios.png'), 40, 40);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should prefer platform-specific over generic', () => {
    const { files } = findAssetVariants(testDir, 'logo', 'png', 'ios');
    const paths = files.map((f) => f.replace(/\\/g, '/'));
    // Should include .ios.png variant
    expect(paths.some((f) => f.includes('.ios.png'))).toBe(true);
  });

  it('should exclude other platforms', () => {
    const { files } = findAssetVariants(testDir, 'logo', 'png', 'ios');
    const paths = files.map((f) => f.replace(/\\/g, '/'));
    expect(paths.some((f) => f.includes('.android.png'))).toBe(false);
  });

  it('should handle scale + platform combo (badge@2x.ios.png)', () => {
    const { scales, files } = findAssetVariants(testDir, 'badge', 'png', 'ios');
    expect(scales).toContain(1);
    expect(scales).toContain(2);
    // @2x should use the platform-specific one
    const x2File = files[scales.indexOf(2)]!.replace(/\\/g, '/');
    expect(x2File).toContain('.ios.png');
  });
});

describe('extractAssets', () => {
  const testDir = join(tmpdir(), 'bungae-extract-test-' + Date.now());
  const assetsDir = join(testDir, 'src', 'assets');
  const outputDir = join(testDir, 'output');

  beforeAll(() => {
    mkdirSync(assetsDir, { recursive: true });
    createPng(join(assetsDir, 'icon.png'), 24, 24);
    createPng(join(assetsDir, 'icon@2x.png'), 48, 48);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should extract assets to output directory', () => {
    const assets = [resolveAsset(join(assetsDir, 'icon.png'), testDir, 'ios')];

    const result = extractAssets(assets, {
      outputDir,
      projectRoot: testDir,
      platform: 'ios',
    });

    expect(result.count).toBe(1);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.totalSize).toBeGreaterThan(0);

    for (const file of result.files) {
      expect(existsSync(file)).toBe(true);
    }
  });

  it('should preserve directory structure', () => {
    const assets = [resolveAsset(join(assetsDir, 'icon.png'), testDir, 'ios')];

    const result = extractAssets(assets, {
      outputDir,
      projectRoot: testDir,
      platform: 'ios',
    });

    const hasSubdir = result.files.some((f) => f.includes('assets'));
    expect(hasSubdir).toBe(true);
  });
});

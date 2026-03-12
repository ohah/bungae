import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { resolveAsset } from '../../plugins/asset';

describe('resolveAsset', () => {
  const testDir = join(tmpdir(), 'bungae-asset-test');
  const assetsDir = join(testDir, 'src', 'assets');

  beforeEach(() => {
    mkdirSync(assetsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should resolve a basic asset with 1x scale', () => {
    const assetPath = join(assetsDir, 'icon.png');
    writeFileSync(assetPath, 'fake-png-data');

    const result = resolveAsset(assetPath, testDir, 'ios');

    expect(result.__packager_asset).toBe(true);
    expect(result.name).toBe('icon');
    expect(result.type).toBe('png');
    expect(result.scales).toEqual([1]);
    expect(result.httpServerLocation).toBe('/src/assets');
    expect(result.hash).toBeTruthy();
  });

  it('should detect scale variants (@2x, @3x)', () => {
    writeFileSync(join(assetsDir, 'icon.png'), 'fake-1x');
    writeFileSync(join(assetsDir, 'icon@2x.png'), 'fake-2x');
    writeFileSync(join(assetsDir, 'icon@3x.png'), 'fake-3x');

    const result = resolveAsset(join(assetsDir, 'icon.png'), testDir, 'ios');

    expect(result.scales).toEqual([1, 2, 3]);
  });

  it('should handle asset without base (only @2x)', () => {
    writeFileSync(join(assetsDir, 'logo@2x.png'), 'fake-2x');

    const result = resolveAsset(join(assetsDir, 'logo@2x.png'), testDir, 'ios');

    expect(result.name).toBe('logo@2x');
    expect(result.type).toBe('png');
  });

  it('should compute unique hash from file content', () => {
    writeFileSync(join(assetsDir, 'a.png'), 'content-a');
    writeFileSync(join(assetsDir, 'b.png'), 'content-b');

    const resultA = resolveAsset(join(assetsDir, 'a.png'), testDir, 'ios');
    const resultB = resolveAsset(join(assetsDir, 'b.png'), testDir, 'ios');

    expect(resultA.hash).not.toBe(resultB.hash);
  });

  it('should use forward slashes in httpServerLocation', () => {
    const assetPath = join(assetsDir, 'icon.png');
    writeFileSync(assetPath, 'fake-png');

    const result = resolveAsset(assetPath, testDir, 'android');

    expect(result.httpServerLocation).not.toContain('\\');
    expect(result.httpServerLocation).toMatch(/^\/src\/assets$/);
  });
});

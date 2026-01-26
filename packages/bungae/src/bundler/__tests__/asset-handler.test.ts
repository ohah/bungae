/**
 * Asset Handler Tests
 *
 * Tests for asset request handler
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import type { ServerResponse } from 'http';
import { join } from 'path';

import { resolveConfig } from '../../config';
import type { ResolvedConfig } from '../../config/types';
import { handleAssetRequest } from '../graph-bundler/server/handlers/asset-handler';

describe('Asset Handler', () => {
  let testDir: string;
  let config: ResolvedConfig;
  let mockRes: ServerResponse;
  let responseStatus: number | null;
  let responseHeaders: Record<string, string>;
  let responseBody: Buffer | null;

  beforeEach(() => {
    testDir = join('/tmp', `bungae-asset-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    config = resolveConfig(
      {
        entry: 'index.js',
        root: testDir,
        dev: true,
        platform: 'ios',
      },
      testDir,
    );

    responseStatus = null;
    responseHeaders = {};
    responseBody = null;

    mockRes = {
      writeHead: mock((status: number, headers?: Record<string, string>) => {
        responseStatus = status;
        if (headers) {
          Object.assign(responseHeaders, headers);
        }
      }),
      end: mock((body?: Buffer | string) => {
        if (body) {
          responseBody = typeof body === 'string' ? Buffer.from(body) : body;
        }
      }),
    } as unknown as ServerResponse;
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      // Note: In real tests, you might want to use rimraf or similar
      // For now, we'll leave the cleanup to the OS
    }
  });

  test('should serve asset from /assets/ path', () => {
    // /assets/ is relative to project root
    // /assets/icon.png -> project root/icon.png
    const assetFile = join(testDir, 'icon.png');
    const assetContent = Buffer.from('fake png content');
    writeFileSync(assetFile, assetContent);

    const url = new URL('http://localhost:8081/assets/icon.png');

    handleAssetRequest(mockRes, url, config);

    expect(responseStatus).toBe(200);
    expect(responseHeaders['Content-Type']).toBe('image/png');
    expect(responseBody).toEqual(assetContent);
  });

  test('should serve asset from /node_modules/ path', () => {
    // Create test asset in node_modules
    const nodeModulesDir = join(
      testDir,
      'node_modules',
      'react-native',
      'Libraries',
      'LogBox',
      'UI',
      'LogBoxImages',
    );
    mkdirSync(nodeModulesDir, { recursive: true });
    const assetFile = join(nodeModulesDir, 'close.png');
    const assetContent = Buffer.from('fake png content');
    writeFileSync(assetFile, assetContent);

    const url = new URL(
      'http://localhost:8081/node_modules/react-native/Libraries/LogBox/UI/LogBoxImages/close.png',
    );

    handleAssetRequest(mockRes, url, config);

    expect(responseStatus).toBe(200);
    expect(responseHeaders['Content-Type']).toBe('image/png');
    expect(responseBody).toEqual(assetContent);
  });

  test('should handle scale suffix (@2x, @3x)', () => {
    // Create test asset without scale suffix
    // /assets/icon@2x.png -> project root/icon.png
    const assetFile = join(testDir, 'icon.png');
    const assetContent = Buffer.from('fake png content');
    writeFileSync(assetFile, assetContent);

    // Request with @2x suffix
    const url = new URL('http://localhost:8081/assets/icon@2x.png');

    handleAssetRequest(mockRes, url, config);

    expect(responseStatus).toBe(200);
    expect(responseHeaders['Content-Type']).toBe('image/png');
    expect(responseBody).toEqual(assetContent);
  });

  test('should return 404 for non-existent asset', () => {
    const url = new URL('http://localhost:8081/assets/nonexistent.png');

    handleAssetRequest(mockRes, url, config);

    expect(responseStatus).toBe(404);
  });

  test('should return 400 for invalid path', () => {
    const url = new URL('http://localhost:8081/invalid/path.png');

    handleAssetRequest(mockRes, url, config);

    expect(responseStatus).toBe(400);
  });

  test('should handle path traversal attempts safely', () => {
    // Try path traversal - should be blocked
    // /assets/../../etc/passwd -> normalized to 'etc/passwd' -> file not found -> 404
    const url = new URL('http://localhost:8081/assets/../../etc/passwd');

    handleAssetRequest(mockRes, url, config);

    // Path traversal is blocked by normalization (../../ is removed)
    // Resulting path 'etc/passwd' doesn't exist, so it returns 404
    // Or if path is completely invalid, might return 400
    expect([400, 403, 404]).toContain(responseStatus);
  });

  test('should support different image formats', () => {
    const formats = [
      { ext: '.jpg', contentType: 'image/jpeg' },
      { ext: '.jpeg', contentType: 'image/jpeg' },
      { ext: '.gif', contentType: 'image/gif' },
      { ext: '.webp', contentType: 'image/webp' },
      { ext: '.svg', contentType: 'image/svg+xml' },
    ];

    for (const { ext, contentType } of formats) {
      // /assets/icon.jpg -> project root/icon.jpg
      const assetFile = join(testDir, `icon${ext}`);
      const assetContent = Buffer.from(`fake ${ext} content`);
      writeFileSync(assetFile, assetContent);

      const url = new URL(`http://localhost:8081/assets/icon${ext}`);

      responseStatus = null;
      responseHeaders = {};
      responseBody = null;

      handleAssetRequest(mockRes, url, config);

      expect(responseStatus).toBe(200);
      expect(responseHeaders['Content-Type']).toBe(contentType);
      expect(responseBody).toEqual(assetContent);
    }
  });

  test('should handle monorepo node_modules paths', () => {
    // Create monorepo structure
    const monorepoRoot = join(testDir, '..', 'monorepo-root');
    const monorepoNodeModules = join(monorepoRoot, 'node_modules', 'react-native', 'Libraries');
    mkdirSync(monorepoNodeModules, { recursive: true });
    const assetFile = join(monorepoNodeModules, 'test.png');
    const assetContent = Buffer.from('fake png content');
    writeFileSync(assetFile, assetContent);

    // Update config to include monorepo node_modules path
    const monorepoConfig = resolveConfig(
      {
        entry: 'index.js',
        root: testDir,
        dev: true,
        platform: 'ios',
        resolver: {
          nodeModulesPaths: [join(monorepoRoot, 'node_modules')],
        },
      },
      testDir,
    );

    const url = new URL('http://localhost:8081/node_modules/react-native/Libraries/test.png');

    handleAssetRequest(mockRes, url, monorepoConfig);

    expect(responseStatus).toBe(200);
    expect(responseHeaders['Content-Type']).toBe('image/png');
    expect(responseBody).toEqual(assetContent);
  });
});

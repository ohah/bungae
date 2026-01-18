import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

import { createPlatformResolverPlugin } from '../platform-plugin';

describe('Platform Resolver Plugin', () => {
  const testRoot = join(process.cwd(), '.test-resolver');
  const testDir = join(testRoot, 'src', 'components');

  beforeEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('should resolve .ios.js file for ios platform', () => {
    const iosFile = join(testDir, 'Button.ios.js');
    const androidFile = join(testDir, 'Button.android.js');
    const defaultFile = join(testDir, 'Button.js');

    writeFileSync(iosFile, 'export default "ios";');
    writeFileSync(androidFile, 'export default "android";');
    writeFileSync(defaultFile, 'export default "default";');

    const plugin = createPlatformResolverPlugin({
      platform: 'ios',
      sourceExts: ['.js'],
    });

    // Mock build object
    const mockBuild = {
      onResolve: (options: any, callback: any) => {
        const result = callback({
          path: './Button',
          importer: join(testDir, 'App.js'),
        });

        expect(result).toBeDefined();
        expect(result?.path).toBe(iosFile);
      },
    };

    plugin.setup(mockBuild as any);
  });

  test('should resolve .android.js file for android platform', () => {
    const iosFile = join(testDir, 'Button.ios.js');
    const androidFile = join(testDir, 'Button.android.js');
    const defaultFile = join(testDir, 'Button.js');

    writeFileSync(iosFile, 'export default "ios";');
    writeFileSync(androidFile, 'export default "android";');
    writeFileSync(defaultFile, 'export default "default";');

    const plugin = createPlatformResolverPlugin({
      platform: 'android',
      sourceExts: ['.js'],
    });

    const mockBuild = {
      onResolve: (options: any, callback: any) => {
        const result = callback({
          path: './Button',
          importer: join(testDir, 'App.js'),
        });

        expect(result).toBeDefined();
        expect(result?.path).toBe(androidFile);
      },
    };

    plugin.setup(mockBuild as any);
  });

  test('should resolve .native.js when preferNativePlatform is true', () => {
    const iosFile = join(testDir, 'Button.ios.js');
    const nativeFile = join(testDir, 'Button.native.js');
    const defaultFile = join(testDir, 'Button.js');

    writeFileSync(iosFile, 'export default "ios";');
    writeFileSync(nativeFile, 'export default "native";');
    writeFileSync(defaultFile, 'export default "default";');

    const plugin = createPlatformResolverPlugin({
      platform: 'ios',
      sourceExts: ['.js'],
      preferNativePlatform: true,
    });

    const mockBuild = {
      onResolve: (options: any, callback: any) => {
        // First try .ios.js (should exist)
        // But if we remove .ios.js, should try .native.js
        rmSync(iosFile);
        const result = callback({
          path: './Button',
          importer: join(testDir, 'App.js'),
        });

        expect(result).toBeDefined();
        expect(result?.path).toBe(nativeFile);
      },
    };

    plugin.setup(mockBuild as any);
  });

  test('should resolve default .js when platform-specific not found', () => {
    const defaultFile = join(testDir, 'Button.js');

    writeFileSync(defaultFile, 'export default "default";');

    const plugin = createPlatformResolverPlugin({
      platform: 'ios',
      sourceExts: ['.js'],
    });

    const mockBuild = {
      onResolve: (options: any, callback: any) => {
        const result = callback({
          path: './Button',
          importer: join(testDir, 'App.js'),
        });

        expect(result).toBeDefined();
        expect(result?.path).toBe(defaultFile);
      },
    };

    plugin.setup(mockBuild as any);
  });

  test('should handle TypeScript extensions', () => {
    const iosFile = join(testDir, 'Button.ios.tsx');
    const defaultFile = join(testDir, 'Button.tsx');

    writeFileSync(iosFile, 'export default "ios";');
    writeFileSync(defaultFile, 'export default "default";');

    const plugin = createPlatformResolverPlugin({
      platform: 'ios',
      sourceExts: ['.tsx', '.ts', '.jsx', '.js'],
    });

    const mockBuild = {
      onResolve: (options: any, callback: any) => {
        const result = callback({
          path: './Button',
          importer: join(testDir, 'App.tsx'),
        });

        expect(result).toBeDefined();
        expect(result?.path).toBe(iosFile);
      },
    };

    plugin.setup(mockBuild as any);
  });
});

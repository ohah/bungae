/**
 * Platform Resolver Plugin for Bun
 *
 * Handles React Native platform-specific file extensions:
 * - .ios.js, .android.js, .native.js
 *
 * Note: package.json react-native and browser fields are handled by Bun's
 * built-in resolution. Bun supports these fields through its standard
 * module resolution algorithm.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';

import type { BunPlugin } from 'bun';

export interface PlatformResolverOptions {
  platform: 'ios' | 'android' | 'web';
  sourceExts: string[];
  preferNativePlatform?: boolean;
}

/**
 * Create platform resolver plugin
 *
 * This plugin handles platform-specific file extensions for relative imports.
 * Bun's built-in resolution already handles:
 * - package.json "react-native" field
 * - package.json "browser" field
 * - package.json "main", "module", "exports" fields
 */
export function createPlatformResolverPlugin(options: PlatformResolverOptions): BunPlugin {
  const { platform, sourceExts, preferNativePlatform = true } = options;

  return {
    name: 'bungae-platform-resolver',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // Skip absolute paths (already resolved)
        if (args.path.startsWith('/')) {
          return undefined;
        }

        // Only handle relative paths (./, ../)
        // Package imports are handled by Bun's built-in resolution
        if (!args.path.startsWith('.')) {
          return undefined;
        }

        const importerDir = args.importer ? dirname(args.importer) : process.cwd();
        const basePath = args.path;

        // Build extension priority list
        const extensions: string[] = [];

        // 1. Platform-specific extensions
        if (platform !== 'web') {
          for (const ext of sourceExts) {
            extensions.push(`.${platform}${ext}`);
          }
        }

        // 2. Native extensions (if preferNativePlatform)
        if (preferNativePlatform && platform !== 'web') {
          for (const ext of sourceExts) {
            extensions.push(`.native${ext}`);
          }
        }

        // 3. Default extensions
        for (const ext of sourceExts) {
          extensions.push(ext);
        }

        // Try each extension
        for (const ext of extensions) {
          const candidate = join(importerDir, `${basePath}${ext}`);
          if (existsSync(candidate)) {
            return {
              path: candidate,
            };
          }
        }

        // Let Bun handle the rest
        return undefined;
      });
    },
  };
}

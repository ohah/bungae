/**
 * Prelude and Platform Extensions for ZTS Bundler
 *
 * Shared utilities for generating prelude code and platform-specific
 * file extension resolution order.
 */

import type { Platform } from '../../config/types';

/**
 * Build platform-specific file extension resolution order.
 *
 * For iOS: ['.ios.tsx', '.ios.ts', '.ios.js', '.native.tsx', '.native.ts', '.native.js', '.tsx', '.ts', '.js', ...]
 * For Android: ['.android.tsx', '.android.ts', '.android.js', '.native.tsx', ...]
 */
export function buildExtensions(platform: Platform, sourceExts?: string[]): string[] {
  const baseExts = sourceExts || ['tsx', 'ts', 'jsx', 'js', 'json'];

  const extensions: string[] = [];

  // Platform-specific extensions first
  for (const ext of baseExts) {
    extensions.push(`.${platform}.${ext}`);
  }

  // Native extensions (shared between iOS/Android)
  if (platform === 'ios' || platform === 'android') {
    for (const ext of baseExts) {
      extensions.push(`.native.${ext}`);
    }
  }

  // Base extensions
  for (const ext of baseExts) {
    extensions.push(`.${ext}`);
  }

  return extensions;
}

/**
 * Generate prelude code that runs before any module.
 * Sets up global variables required by React Native.
 */
export function generatePreludeCode(dev: boolean, platform: Platform): string {
  const lines = [
    `var __DEV__ = ${dev};`,
    `var process = { env: { NODE_ENV: ${dev ? '"development"' : '"production"'} } };`,
    `var __BUNDLE_START_TIME__ = globalThis.nativePerformanceNow ? nativePerformanceNow() : Date.now();`,
    `var global = globalThis;`,
  ];

  return lines.join('\n');
}

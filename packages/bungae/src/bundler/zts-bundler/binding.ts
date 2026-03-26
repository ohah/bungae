/**
 * ZTS NAPI Binding Loader
 *
 * Loads the ZTS native addon (.node file) for the current platform.
 * Falls back to a helpful error message if the binary is not found.
 *
 * TODO: Implement actual NAPI loading once ZTS Zig addon is built.
 */

import type { ZtsNativeBinding } from './types';

let cachedBinding: ZtsNativeBinding | null = null;

/**
 * Get the platform-specific package name for the ZTS binary.
 *
 * Follows esbuild convention:
 *   @bungae/zts-darwin-arm64
 *   @bungae/zts-darwin-x64
 *   @bungae/zts-linux-x64
 *   @bungae/zts-win32-x64
 */
function getNativePackageName(): string {
  const platform = process.platform;
  const arch = process.arch;
  return `@bungae/zts-${platform}-${arch}`;
}

/**
 * Load the ZTS NAPI addon.
 * Caches the binding after first load.
 */
export function loadZtsBinding(): ZtsNativeBinding {
  if (cachedBinding) return cachedBinding;

  const packageName = getNativePackageName();

  try {
    // TODO: Replace with actual NAPI require once ZTS addon is built
    // cachedBinding = require(packageName) as ZtsNativeBinding;
    // return cachedBinding;

    throw new Error(
      `ZTS native binding not yet available.\n` +
        `  Expected package: ${packageName}\n` +
        `  ZTS bundler is under development. Use bundler: 'oxc' or 'graph' for now.`,
    );
  } catch (error: any) {
    if (error.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `ZTS native binding not found for your platform.\n` +
          `  Expected package: ${packageName}\n` +
          `  Try: npm install ${packageName}\n` +
          `  Or use bundler: 'oxc' or 'graph' as an alternative.`,
      );
    }
    throw error;
  }
}

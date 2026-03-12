/**
 * Find hermesc binary from react-native SDK
 *
 * Uses require.resolve to find react-native's location,
 * which works correctly in monorepos (yarn workspaces, pnpm, npm).
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';

const PLATFORM_MAP: Record<string, string> = {
  darwin: 'osx',
  linux: 'linux64',
  win32: 'win64',
};

/**
 * Find hermesc binary path from react-native SDK
 *
 * @param projectRoot - Project root directory
 * @returns hermesc binary path, or null if not found
 */
export function findHermesc(projectRoot: string): string | null {
  const osPlatform = PLATFORM_MAP[process.platform];
  if (!osPlatform) return null;

  try {
    // Use require.resolve to handle monorepo hoisting correctly
    const rnPackageJson = require.resolve('react-native/package.json', {
      paths: [projectRoot],
    });
    const rnRoot = dirname(rnPackageJson);
    const hermescPath = join(
      rnRoot,
      'sdks',
      'hermesc',
      `${osPlatform}-bin`,
      'hermesc',
    );

    if (existsSync(hermescPath)) return hermescPath;

    // Fallback: check if hermesc is installed globally
    return null;
  } catch {
    // react-native not found
    return null;
  }
}

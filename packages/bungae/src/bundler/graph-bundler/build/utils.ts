/**
 * Build utilities for Graph Bundler
 */

import { resolve, relative } from 'path';
import type { ResolvedConfig } from '../../../config/types';

/**
 * Metro-compatible: Build source request routing map for getSourceUrl
 * This ensures verboseName matches source map sources path for console logs
 */
export function buildSourceRequestRoutingMap(
  config: ResolvedConfig,
): Array<[string, string]> {
  const sourceRequestRoutingMap: Array<[string, string]> = [
    ['[metro-project]/', resolve(config.root)],
  ];
  for (let i = 0; i < config.resolver.nodeModulesPaths.length; i++) {
    const nodeModulesPath = config.resolver.nodeModulesPaths[i];
    if (nodeModulesPath) {
      const absolutePath = resolve(config.root, nodeModulesPath);
      sourceRequestRoutingMap.push([`[metro-watchFolders]/${i}/`, absolutePath]);
    }
  }
  return sourceRequestRoutingMap;
}

/**
 * Metro-compatible: getSourceUrl function for verboseName and source map
 * This ensures verboseName matches source map sources path for console logs
 */
export function createGetSourceUrl(
  config: ResolvedConfig,
  sourceRequestRoutingMap: Array<[string, string]>,
): (modulePath: string) => string {
  return (modulePath: string): string => {
    for (const [pathnamePrefix, normalizedRootDir] of sourceRequestRoutingMap) {
      const normalizedRootDirWithSep =
        normalizedRootDir +
        (normalizedRootDir.endsWith('/') || normalizedRootDir.endsWith('\\') ? '' : '/');
      if (modulePath.startsWith(normalizedRootDirWithSep) || modulePath === normalizedRootDir) {
        const relativePath =
          modulePath === normalizedRootDir ? '' : modulePath.slice(normalizedRootDir.length + 1);
        const relativePathPosix = relativePath
          .split(/[/\\]/)
          .map((segment) => encodeURIComponent(segment))
          .join('/');
        return pathnamePrefix + relativePathPosix;
      }
    }
    // Fallback: if no match, use relative path from project root
    const relativeModulePath = relative(config.root, modulePath).replace(/\\/g, '/');
    return `[metro-project]/${relativeModulePath}`;
  };
}

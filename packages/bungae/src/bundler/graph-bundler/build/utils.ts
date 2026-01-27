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
  // Metro-compatible: Metro uses '/[metro-project]/' (with leading slash)
  // This is important for source map sources path matching
  const sourceRequestRoutingMap: Array<[string, string]> = [
    ['/[metro-project]/', resolve(config.root)],
  ];
  // Metro uses watchFolders, but Bungae uses nodeModulesPaths
  // For compatibility, we'll use watchFolders if available, otherwise nodeModulesPaths
  const watchFolders = (config as unknown as { watchFolders?: string[] }).watchFolders || [];
  for (let i = 0; i < watchFolders.length; i++) {
    const watchFolder = watchFolders[i];
    if (watchFolder) {
      const absolutePath = resolve(watchFolder);
      // Metro-compatible: Metro uses '/[metro-watchFolders]/${index}/' (with leading slash)
      sourceRequestRoutingMap.push([`/[metro-watchFolders]/${i}/`, absolutePath]);
    }
  }
  // Fallback to nodeModulesPaths if watchFolders is not available
  if (watchFolders.length === 0) {
    for (let i = 0; i < config.resolver.nodeModulesPaths.length; i++) {
      const nodeModulesPath = config.resolver.nodeModulesPaths[i];
      if (nodeModulesPath) {
        const absolutePath = resolve(config.root, nodeModulesPath);
        sourceRequestRoutingMap.push([`/[metro-watchFolders]/${i}/`, absolutePath]);
      }
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
    // Metro-compatible: Match Metro's _getModuleSourceUrl implementation exactly
    // Metro checks: module.path.startsWith(normalizedRootDir + path.sep)
    for (const [pathnamePrefix, normalizedRootDir] of sourceRequestRoutingMap) {
      // Metro uses path.sep (platform-specific separator)
      // We need to check both normalizedRootDir + '/' and normalizedRootDir + '\' for cross-platform compatibility
      const normalizedRootDirWithSep = normalizedRootDir + '/';
      const normalizedRootDirWithBackSep = normalizedRootDir + '\\';
      
      if (
        modulePath.startsWith(normalizedRootDirWithSep) ||
        modulePath.startsWith(normalizedRootDirWithBackSep) ||
        modulePath === normalizedRootDir
      ) {
        const relativePath =
          modulePath === normalizedRootDir
            ? ''
            : modulePath.slice(normalizedRootDir.length + 1);
        // Metro-compatible: split by path.sep, encode each segment, join with '/'
        const relativePathPosix = relativePath
          .split(/[/\\]/)
          .map((segment) => encodeURIComponent(segment))
          .join('/');
        return pathnamePrefix + relativePathPosix;
      }
    }
    // Metro-compatible fallback: Ordinarily all files should match one of the roots above.
    // If they don't, try to preserve useful information, even if fetching the path
    // from Metro might fail.
    // Metro's fallback: Convert module.path to POSIX format and ensure it starts with '/'
    const modulePathPosix = modulePath
      .split(/[/\\]/)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return modulePathPosix.startsWith('/') ? modulePathPosix : '/' + modulePathPosix;
  };
}

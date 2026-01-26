/**
 * Asset request handler
 * Metro-compatible asset resolution
 */

import { existsSync, readFileSync, readdirSync, realpathSync, lstatSync } from 'fs';
import type { ServerResponse } from 'http';
import { extname, resolve, sep, dirname, basename } from 'path';

import type { ResolvedConfig } from '../../../../config/types';
import { sendText } from '../utils';

/**
 * Handle asset request
 * Metro-compatible: supports /assets/ and /node_modules/ paths
 */
export function handleAssetRequest(res: ServerResponse, url: URL, config: ResolvedConfig): void {
  try {
    let assetRelativePath: string;
    if (url.pathname.startsWith('/assets/')) {
      // /assets/ is relative to project root
      // /assets/icon.png -> icon.png (project root)
      // /assets/subdir/icon.png -> subdir/icon.png
      assetRelativePath = url.pathname.slice('/assets/'.length);
      const pathSegments = assetRelativePath.split('/');
      const resolvedSegments: string[] = [];
      for (const segment of pathSegments) {
        if (segment === '..') {
          if (resolvedSegments.length > 0) {
            resolvedSegments.pop();
          }
        } else if (segment !== '.' && segment !== '') {
          resolvedSegments.push(segment);
        }
      }
      assetRelativePath = resolvedSegments.join('/');
    } else if (url.pathname.startsWith('/node_modules/')) {
      assetRelativePath = url.pathname.slice('/node_modules/'.length);
      assetRelativePath = `node_modules/${assetRelativePath}`;
    } else {
      sendText(res, 400, 'Bad Request');
      return;
    }

    // Remove scale suffix (e.g., @2x.png -> .png)
    assetRelativePath = assetRelativePath.replace(/@\d+x\./, '.');
    assetRelativePath = assetRelativePath.replace(/\\/g, '/');
    const normalizedPath = assetRelativePath.replace(/\//g, sep);

    // Metro-compatible: Try direct path first
    let resolvedAssetPath = resolve(config.root, normalizedPath);

    // Helper function to resolve symlinks recursively (for Bun's .bun directory)
    const resolveSymlink = (path: string, maxDepth: number = 10): string => {
      if (maxDepth <= 0) return path;
      try {
        if (existsSync(path)) {
          const stats = lstatSync(path);
          if (stats.isSymbolicLink()) {
            const resolved = realpathSync(path);
            // Recursively resolve if it's still a symlink
            return resolveSymlink(resolved, maxDepth - 1);
          }
        }
      } catch {
        // Ignore errors
      }
      return path;
    };

    // Try to resolve symlink if it exists
    if (existsSync(resolvedAssetPath)) {
      resolvedAssetPath = resolveSymlink(resolvedAssetPath);
    }

    if (!existsSync(resolvedAssetPath)) {
      // Try alternative paths (monorepo support)
      for (const nodeModulesPath of config.resolver.nodeModulesPaths) {
        const monorepoPath = resolve(config.root, nodeModulesPath);
        const alternativePath = resolve(monorepoPath, '..', normalizedPath);
        if (existsSync(alternativePath)) {
          resolvedAssetPath = resolveSymlink(alternativePath);
          break;
        }
      }
    }

    // Metro-compatible: If still not found, try to resolve through various package manager structures
    // Supports: npm/yarn (hoisted), pnpm, Bun, and non-hoisted cases
    if (!existsSync(resolvedAssetPath)) {
      // Extract package name and path from node_modules structure
      // Pattern: node_modules[/.pnpm|/.bun]/package-name[@version]/node_modules/package-name/rest/path
      // or: node_modules/package-name/rest/path (hoisted)
      // Bun encodes @scope/package as @scope+package in .bun directory
      const nodeModulesMatch = normalizedPath.match(
        /node_modules[\/\\](?:\.(?:pnpm|bun)[\/\\]([^\/\\]+)[\/\\]node_modules[\/\\])?([^\/\\]+)[\/\\](.+)$/,
      );

      if (nodeModulesMatch && nodeModulesMatch[2] && nodeModulesMatch[3]) {
        const bunPackageDir = nodeModulesMatch[1]; // e.g., @react-native+new-app-screen@0.83.1+hash
        const packageNameOrPath = nodeModulesMatch[2]; // e.g., @react-native/new-app-screen or package-name
        const restPath = nodeModulesMatch[3];

        // Strategy 1: Try hoisted path (npm/yarn standard)
        // node_modules/package-name/rest/path
        if (!bunPackageDir && packageNameOrPath && !packageNameOrPath.includes('@')) {
          const hoistedPath = resolve(config.root, 'node_modules', packageNameOrPath, restPath);
          if (existsSync(hoistedPath)) {
            resolvedAssetPath = resolveSymlink(hoistedPath);
          }
        }

        // Strategy 2: Try scoped package (hoisted)
        // node_modules/@scope/package/rest/path
        if (
          !existsSync(resolvedAssetPath) &&
          packageNameOrPath &&
          packageNameOrPath.startsWith('@')
        ) {
          const scopedPath = resolve(config.root, 'node_modules', packageNameOrPath, restPath);
          if (existsSync(scopedPath)) {
            resolvedAssetPath = resolveSymlink(scopedPath);
          }
        }

        // Strategy 3: Try pnpm structure
        // node_modules/.pnpm/package-name@version/node_modules/package-name/rest/path
        if (!existsSync(resolvedAssetPath)) {
          const pnpmDir = resolve(config.root, 'node_modules', '.pnpm');
          if (existsSync(pnpmDir)) {
            try {
              const entries = readdirSync(pnpmDir);
              // Find package directory (e.g., @react-native+new-app-screen@0.83.1 or package-name@version)
              for (const entry of entries) {
                // Check if entry matches package name pattern
                if (!packageNameOrPath) continue;
                const packageName = packageNameOrPath.startsWith('@')
                  ? packageNameOrPath.replace('/', '+') // Convert @scope/package to @scope+package
                  : packageNameOrPath;

                if (entry.startsWith(`${packageName}@`) || entry === packageName) {
                  const pnpmPackagePath = resolve(
                    pnpmDir,
                    entry,
                    'node_modules',
                    packageNameOrPath,
                    restPath,
                  );
                  if (existsSync(pnpmPackagePath)) {
                    resolvedAssetPath = resolveSymlink(pnpmPackagePath);
                    break;
                  }
                }
              }
            } catch {
              // Ignore errors
            }
          }
        }

        // Strategy 4: Try Bun structure (Metro-compatible)
        // node_modules/.bun/@scope+package@version+hash/node_modules/@scope/package/rest/path
        // Bun encodes @scope/package as @scope+package in directory name
        // Check both project root and nodeModulesPaths for .bun directory (monorepo support)
        if (!existsSync(resolvedAssetPath)) {
          const bunDirPaths = [
            resolve(config.root, 'node_modules', '.bun'),
            ...config.resolver.nodeModulesPaths.map((p) => resolve(config.root, p, '.bun')),
          ];

          for (const bunDir of bunDirPaths) {
            if (existsSync(resolvedAssetPath)) break;
            if (!existsSync(bunDir)) continue;

            try {
              const entries = readdirSync(bunDir);

              // If we have bunPackageDir from the match, use it directly
              if (bunPackageDir && packageNameOrPath && restPath) {
                const bunPackageDirPath = resolve(bunDir, bunPackageDir);
                if (existsSync(bunPackageDirPath)) {
                  const resolvedBunDir = resolveSymlink(bunPackageDirPath);
                  const bunPackagePath = resolve(
                    resolvedBunDir,
                    'node_modules',
                    packageNameOrPath,
                    restPath,
                  );
                  if (existsSync(bunPackagePath)) {
                    resolvedAssetPath = resolveSymlink(bunPackagePath);
                  }
                }
              } else if (packageNameOrPath && restPath) {
                // Search for matching package directory
                // Convert @scope/package to @scope+package for Bun directory matching
                const bunPackageName = packageNameOrPath.startsWith('@')
                  ? packageNameOrPath.replace('/', '+')
                  : packageNameOrPath;

                for (const entry of entries) {
                  // Bun directory format: @scope+package@version+hash or package@version+hash
                  if (entry.startsWith(`${bunPackageName}@`) || entry === bunPackageName) {
                    const bunPackageDirPath = resolve(bunDir, entry);
                    const resolvedBunDir = resolveSymlink(bunPackageDirPath);
                    // Inside .bun directory, the actual package is at node_modules/@scope/package
                    const bunPackagePath = resolve(
                      resolvedBunDir,
                      'node_modules',
                      packageNameOrPath,
                      restPath,
                    );
                    if (existsSync(bunPackagePath)) {
                      resolvedAssetPath = resolveSymlink(bunPackagePath);
                      break;
                    }
                  }
                }
              }
            } catch {
              // Ignore errors
            }
          }
        }

        // Strategy 5: Try non-hoisted path (nested node_modules)
        // node_modules/package-name/node_modules/dependency/rest/path
        if (!existsSync(resolvedAssetPath) && packageNameOrPath && restPath) {
          const nonHoistedPath = resolve(
            config.root,
            'node_modules',
            packageNameOrPath,
            'node_modules',
            restPath,
          );
          if (existsSync(nonHoistedPath)) {
            resolvedAssetPath = resolveSymlink(nonHoistedPath);
          }
        }

        // Strategy 6: Try in monorepo node_modules paths
        if (!existsSync(resolvedAssetPath) && packageNameOrPath && restPath) {
          for (const nodeModulesPath of config.resolver.nodeModulesPaths) {
            const monorepoNodeModules = resolve(config.root, nodeModulesPath);
            const monorepoPath = resolve(monorepoNodeModules, packageNameOrPath, restPath);
            if (existsSync(monorepoPath)) {
              resolvedAssetPath = resolveSymlink(monorepoPath);
              break;
            }
          }
        }

        // Strategy 7: Metro-compatible - Try require.resolve for node_modules assets
        // This handles all edge cases including symlinks and complex package manager structures
        // Note: In Bun, require.resolve might not work as expected, so we use it as a last resort
        if (!existsSync(resolvedAssetPath) && normalizedPath.startsWith('node_modules')) {
          try {
            // Extract module specifier from path
            // e.g., node_modules/@react-native/new-app-screen/src/assets/react-light.png
            // -> @react-native/new-app-screen
            const modulePath = normalizedPath.replace(/^node_modules[\/\\]/, '');

            // Extract package name (first segment for scoped, or first segment for non-scoped)
            let packageName: string | undefined;
            if (modulePath.startsWith('@')) {
              // Scoped package: @scope/package
              const match = modulePath.match(/^(@[^\/\\]+[\/\\][^\/\\]+)/);
              packageName = match ? match[1] : modulePath.split(sep)[0];
            } else {
              // Non-scoped package: package-name
              packageName = modulePath.split(sep)[0];
            }

            if (!packageName) {
              throw new Error('Could not extract package name from path');
            }

            // Get the relative path within the package
            const packageRelativePath = modulePath.slice(packageName.length + 1);

            // Try resolving the package directory using require.resolve
            // Note: In Bun, this might throw or return unexpected paths, so we catch and continue
            let packageJsonPath: string;
            try {
              packageJsonPath = require.resolve(`${packageName}/package.json`, {
                paths: [config.root, ...(config.resolver.nodeModulesPaths || [])],
              });
            } catch (resolveError) {
              // require.resolve failed, try manual lookup
              // Try common locations for package.json
              const possiblePaths = [
                resolve(config.root, 'node_modules', packageName, 'package.json'),
                ...(config.resolver.nodeModulesPaths || []).map((p) =>
                  resolve(config.root, p, packageName, 'package.json'),
                ),
              ];

              let foundPath: string | undefined;
              for (const possiblePath of possiblePaths) {
                if (existsSync(possiblePath)) {
                  foundPath = possiblePath;
                  break;
                }
              }

              if (!foundPath) {
                throw resolveError; // Re-throw if we couldn't find it manually either
              }

              packageJsonPath = foundPath;
            }

            const packageDir = dirname(packageJsonPath);
            const assetPath = resolve(packageDir, packageRelativePath);

            if (existsSync(assetPath)) {
              resolvedAssetPath = resolveSymlink(assetPath);
            }
          } catch (error) {
            // All strategies failed, resolvedAssetPath will remain as initial value
            // This is OK - we'll return 404 below
          }
        }
      }
    }

    const normalizedAssetPath = resolve(resolvedAssetPath);
    const normalizedRoot = resolve(config.root);

    let isAllowed = normalizedAssetPath.startsWith(normalizedRoot);
    if (!isAllowed) {
      isAllowed = config.resolver.nodeModulesPaths.some((p) => {
        const monorepoNodeModules = resolve(config.root, p);
        return normalizedAssetPath.startsWith(monorepoNodeModules);
      });
    }

    if (!isAllowed) {
      console.warn(`Asset path outside allowed directories: ${normalizedAssetPath}`);
      sendText(res, 403, 'Forbidden');
      return;
    }

    if (!existsSync(normalizedAssetPath)) {
      console.warn(`Asset not found: ${normalizedAssetPath} (requested: ${url.pathname})`);
      sendText(res, 404, 'Not Found');
      return;
    }

    const ext = extname(normalizedAssetPath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.json': 'application/json',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    const fileContent = readFileSync(normalizedAssetPath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000',
      'Content-Length': fileContent.length,
    });
    res.end(fileContent);
  } catch (error) {
    console.error(`Error serving asset ${url.pathname}:`, error);
    sendText(res, 500, 'Internal Server Error');
  }
}

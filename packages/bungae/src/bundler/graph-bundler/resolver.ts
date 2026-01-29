/**
 * Module resolution for Graph Bundler
 */

import { existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import type { ResolvedConfig } from '../../config/types';

/** React Native HMRClient path pattern - replace with Bungae HMR client in dev (Rollipop-style) */
const RN_HMR_CLIENT_PATTERN = /[/\\]Libraries[/\\]Utilities[/\\]HMRClient\.js$/;

function getBungaeHMRClientPath(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('bungae/package.json');
    const pkgDir = dirname(pkgPath);
    const distPath = join(pkgDir, 'dist', 'runtime', 'bungae-hmr-client.js');
    if (existsSync(distPath)) {
      return distPath;
    }
    const srcPath = join(
      pkgDir,
      'src',
      'bundler',
      'graph-bundler',
      'runtime',
      'bungae-hmr-client.js',
    );
    if (existsSync(srcPath)) {
      return srcPath;
    }
    return distPath;
  } catch {
    return join(dirname(fileURLToPath(import.meta.url)), 'runtime', 'bungae-hmr-client.js');
  }
}

/**
 * Try to find platform-specific version of a file
 * e.g., Settings.js -> Settings.android.js or Settings.ios.js
 */
export function tryPlatformSpecificFile(
  resolvedPath: string,
  platform: string,
  resolver: ResolvedConfig['resolver'],
): string | null {
  // Get the base path without extension
  const extMatch = resolvedPath.match(/\.[^.]+$/);
  if (!extMatch) return null;

  const ext = extMatch[0];
  const basePath = resolvedPath.slice(0, -ext.length);

  // Try platform-specific extension first
  const platformPath = `${basePath}.${platform}${ext}`;
  if (existsSync(platformPath)) {
    return platformPath;
  }

  // Try .native extension if preferNativePlatform
  if (resolver.preferNativePlatform) {
    const nativePath = `${basePath}.native${ext}`;
    if (existsSync(nativePath)) {
      return nativePath;
    }
  }

  return null;
}

/**
 * Resolve module path with platform-specific extensions
 */
export async function resolveModule(
  fromPath: string,
  moduleSpecifier: string,
  config: ResolvedConfig,
): Promise<string | null> {
  const fromDir = dirname(fromPath);
  const { platform, resolver } = config;

  // Handle relative paths
  if (moduleSpecifier.startsWith('.')) {
    const basePath = resolve(fromDir, moduleSpecifier);

    // Build extension priority list
    const extensions: string[] = [];

    // 1. Platform-specific extensions
    if (platform !== 'web') {
      for (const ext of resolver.sourceExts) {
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        extensions.push(`.${platform}${normalizedExt}`);
      }
    }

    // 2. Native extensions (if preferNativePlatform)
    if (resolver.preferNativePlatform && platform !== 'web') {
      for (const ext of resolver.sourceExts) {
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        extensions.push(`.native${normalizedExt}`);
      }
    }

    // 3. Default extensions
    for (const ext of resolver.sourceExts) {
      extensions.push(ext.startsWith('.') ? ext : `.${ext}`);
    }

    // Try each extension
    for (const ext of extensions) {
      const candidate = `${basePath}${ext}`;
      if (
        existsSync(candidate) &&
        !candidate.endsWith('.flow.js') &&
        !candidate.endsWith('.flow')
      ) {
        return candidate;
      }
    }

    // Try without extension (if it's already a file, including assets)
    if (existsSync(basePath)) {
      return basePath;
    }

    // Try asset extensions (for image requires like require('./image.png'))
    // assetExts already include the dot (e.g., '.png', '.jpg')
    for (const ext of resolver.assetExts) {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      const assetPath = `${basePath}${normalizedExt}`;
      if (existsSync(assetPath)) {
        return assetPath;
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexPath = join(basePath, `index${ext}`);
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  // Handle node_modules
  try {
    let resolved = require.resolve(moduleSpecifier, {
      paths: [
        fromDir,
        config.root,
        resolve(config.root, 'node_modules'),
        ...resolver.nodeModulesPaths.map((p) => resolve(config.root, p)),
      ],
    });

    // Skip Flow files
    if (resolved.endsWith('.flow.js') || resolved.endsWith('.flow')) {
      const withoutFlow = resolved.replace(/\.flow(\.js)?$/, '.js');
      if (existsSync(withoutFlow)) {
        resolved = withoutFlow;
      } else {
        return null;
      }
    }

    // Check for platform-specific version of the resolved file
    // e.g., Settings.js -> Settings.android.js or Settings.ios.js
    if (platform !== 'web') {
      const platformResolved = tryPlatformSpecificFile(resolved, platform, resolver);
      if (platformResolved) {
        resolved = platformResolved;
      }
    }

    // Rollipop-style: replace react-native HMRClient with Bungae HMR client in dev
    if (config.dev && RN_HMR_CLIENT_PATTERN.test(resolved) && resolved.includes('react-native')) {
      const bungaePath = getBungaeHMRClientPath();
      if (existsSync(bungaePath)) {
        return bungaePath;
      }
    }

    return resolved;
  } catch {
    // Manual lookup fallback
    const nodeModulesPaths = [
      resolve(config.root, 'node_modules'),
      ...resolver.nodeModulesPaths.map((p) => resolve(config.root, p)),
    ];

    for (const nodeModulesPath of nodeModulesPaths) {
      const packagePath = resolve(nodeModulesPath, moduleSpecifier);
      const extensions = resolver.sourceExts;
      if (extensions.length === 0) {
        continue;
      }
      const firstExt = extensions[0];
      if (!firstExt) {
        continue;
      }
      for (const ext of extensions) {
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        const withExt = `${packagePath}${normalizedExt}`;
        if (existsSync(withExt)) {
          return withExt;
        }
      }
      // Try index file
      const indexPath = resolve(
        packagePath,
        `index${firstExt.startsWith('.') ? firstExt : `.${firstExt}`}`,
      );
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }
  }

  return null;
}

/**
 * Source file and source map request handlers
 */

import { existsSync, createReadStream } from 'fs';
import type { ServerResponse } from 'http';
import { extname, resolve } from 'path';

import type { ResolvedConfig } from '../../../../config/types';
import { buildWithGraph } from '../../build/index';
import { getTerminalReporter } from '../../terminal-reporter';
import type { BuildResult } from '../../types';
import { sendText } from '../utils';

/**
 * Handle source file request (Metro-compatible)
 * Processes requests for source files from source maps like [metro-project]/App.tsx
 */
export async function handleSourceFileRequest(
  res: ServerResponse,
  relativeFilePathname: string,
  rootDir: string,
  config: ResolvedConfig,
): Promise<void> {
  // Metro-compatible: Check allowed suffixes
  const allowedSuffixes = [
    ...config.resolver.sourceExts.map((ext) => `.${ext}`),
    ...config.resolver.assetExts.map((ext) => `.${ext}`),
  ];

  // Decode URI-encoded path segments (Metro uses encodeURIComponent)
  let decodedPath = relativeFilePathname
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        // If decoding fails, use original segment
        return segment;
      }
    })
    .join('/');

  // Remove leading slash if present
  if (decodedPath.startsWith('/')) {
    decodedPath = decodedPath.slice(1);
  }

  // Try to find the file
  let filePath = resolve(rootDir, decodedPath);
  let normalizedFilePath = resolve(filePath);
  const normalizedRootDir = resolve(rootDir);

  // Security check: ensure file is within rootDir
  if (!normalizedFilePath.startsWith(normalizedRootDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  // Check if file exists
  if (!existsSync(normalizedFilePath)) {
    // Try with different extensions (Metro-compatible: platform-specific files)
    const pathWithoutExt = normalizedFilePath.replace(/\.[^/.]+$/, '');
    let found = false;

    for (const ext of config.resolver.sourceExts) {
      const tryPath = `${pathWithoutExt}.${ext}`;
      if (existsSync(tryPath)) {
        const resolvedTryPath = resolve(tryPath);
        // Re-check security after resolving with extension to prevent path traversal
        if (!resolvedTryPath.startsWith(normalizedRootDir)) {
          sendText(res, 403, 'Forbidden');
          return;
        }
        normalizedFilePath = resolvedTryPath;
        found = true;
        break;
      }
    }

    if (!found) {
      // Check allowed suffixes only if file doesn't exist
      if (!allowedSuffixes.some((suffix) => relativeFilePathname.endsWith(suffix))) {
        sendText(res, 404, 'Not Found');
        return;
      }
      sendText(res, 404, 'Not Found');
      return;
    }
  }

  // Determine MIME type
  const ext = extname(normalizedFilePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.js': 'application/javascript',
    '.jsx': 'application/javascript',
    '.ts': 'application/typescript',
    '.tsx': 'application/typescript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };

  const mimeType = mimeTypes[ext] || 'text/plain';

  // Metro-compatible: Use streaming (fs.createReadStream) instead of reading entire file
  // This matches Metro's implementation exactly to fix "Cannot read properties of undefined (reading 'stream')" error
  // Metro uses: res.setHeader('Content-Type', mimeType); const stream = fs.createReadStream(filePath); stream.pipe(res);
  // Metro does NOT add charset or other headers for source files
  res.setHeader('Content-Type', mimeType);
  const stream = createReadStream(normalizedFilePath);
  stream.pipe(res);
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      res.writeHead(404);
      res.end();
    } else {
      res.writeHead(500);
      res.end();
    }
  });
}

/**
 * Handle source map request (Metro-compatible)
 * Generates source map on demand if not cached, matching bundle request parameters
 */
export async function handleSourceMapRequest(
  res: ServerResponse,
  url: URL,
  config: ResolvedConfig,
  platform: string,
  cachedBuilds: Map<string, BuildResult>,
): Promise<void> {
  // Log source map request (Metro-compatible)
  const reporter = getTerminalReporter();
  reporter.logMapRequest(config.entry);

  try {
    // Metro-compatible: Parse same parameters as bundle request
    const getBoolParam = (param: string, defaultValue: boolean): boolean => {
      const value = url.searchParams.get(param);
      if (value === null) return defaultValue;
      return value === 'true' || value === '1';
    };

    const mapPlatform = url.searchParams.get('platform') || platform;
    const mapDev = getBoolParam('dev', config.dev);
    const mapMinify = getBoolParam('minify', config.minify ?? false);
    const mapInlineSourceMap = getBoolParam(
      'inlineSourceMap',
      config.serializer?.inlineSourceMap ?? false,
    );
    const mapExcludeSource = getBoolParam('excludeSource', false);
    const mapModulesOnly = getBoolParam('modulesOnly', false);
    const mapRunModule = getBoolParam('runModule', true);
    // sourcePaths: Use client's request value (Metro-compatible)
    // 'absolute' = /Users/.../App.tsx format (Metro default)
    // 'url-server' = [metro-project]/App.tsx format
    const mapSourcePaths = (url.searchParams.get('sourcePaths') || 'absolute') as 'absolute' | 'url-server';

    // Extract bundle name from pathname
    // Metro-compatible: Handle both .map and .bundle.map extensions
    // For .bundle.map, extract bundle name by removing .map suffix
    // For .map, extract bundle name by converting .map to .bundle
    let bundleName: string | undefined;
    if (url.pathname.endsWith('.bundle.map')) {
      // index.bundle.map → index.bundle
      const bundleNameMatch = url.pathname.match(/\/([^/]+\.bundle)\.map$/);
      bundleName = bundleNameMatch ? bundleNameMatch[1] : undefined;
    } else if (url.pathname.endsWith('.map')) {
      // index.map → index.bundle
      const bundleNameMatch = url.pathname.match(/\/([^/]+)\.map$/);
      bundleName = bundleNameMatch ? `${bundleNameMatch[1]}.bundle` : undefined;
    }

    // Create cache key that includes all relevant build parameters
    // This ensures we don't serve stale source maps with different parameters
    const cacheKey = `${mapPlatform}:${mapDev}:${mapMinify}:${mapExcludeSource}:${mapModulesOnly}:${mapRunModule}:${mapSourcePaths}`;
    const cachedBuild = cachedBuilds.get(cacheKey);

    // If cached build exists and parameters match, use it
    if (cachedBuild?.map) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'devtools://devtools', // Metro-compatible: Use devtools://devtools instead of *
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff', // Metro-compatible: Add security header
      });
      res.end(cachedBuild.map);
      return;
    }

    // If no cached build, generate source map on demand (Metro-compatible)
    // Build with same parameters as bundle request
    const mapConfig: ResolvedConfig = {
      ...config,
      platform: mapPlatform as 'ios' | 'android' | 'web',
      dev: mapDev,
      minify: mapMinify,
      serializer: {
        ...config.serializer,
        inlineSourceMap: mapInlineSourceMap,
      },
    };

    const build = await buildWithGraph(mapConfig, undefined, {
      excludeSource: mapExcludeSource,
      modulesOnly: mapModulesOnly,
      runModule: mapRunModule,
      bundleName,
      sourcePaths: mapSourcePaths, // Use client's request value (Metro-compatible)
    });

    // Cache the build with the parameter-based key
    if (build.map) {
      cachedBuilds.set(cacheKey, build);
    }

    if (build.map) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'devtools://devtools', // Metro-compatible: Use devtools://devtools instead of *
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff', // Metro-compatible: Add security header
      });
      res.end(build.map);
    } else {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'devtools://devtools', // Metro-compatible: Use devtools://devtools instead of *
        'X-Content-Type-Options': 'nosniff', // Metro-compatible: Add security header
      });
      res.end('{}');
    }
  } catch (error) {
    console.error('Source map generation failed:', error);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'devtools://devtools', // Metro-compatible: Use devtools://devtools instead of *
      'X-Content-Type-Options': 'nosniff', // Metro-compatible: Add security header
    });
    res.end('{}');
  }
}

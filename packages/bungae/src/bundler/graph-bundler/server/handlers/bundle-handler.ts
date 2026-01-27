/**
 * Bundle request handler
 */

import type { IncomingMessage, ServerResponse } from 'http';

import type { ResolvedConfig } from '../../../../config/types';
import { buildWithGraph } from '../../build/index';
import { getTerminalReporter } from '../../terminal-reporter';
import type { BuildResult } from '../../types';
import * as jscSafeUrl from 'jsc-safe-url';

/**
 * Handle bundle request
 */
export async function handleBundleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: ResolvedConfig,
  platform: string,
  port: number,
  cachedBuilds: Map<string, BuildResult>,
  buildingPlatforms: Map<string, Promise<BuildResult>>,
  saveBuildStateForHMR: (requestPlatform: string, build: BuildResult) => void,
): Promise<void> {
  try {
    // Metro-compatible: Parse bundle request query parameters
    const getBoolParam = (param: string, defaultValue: boolean): boolean => {
      const value = url.searchParams.get(param);
      if (value === null) return defaultValue;
      return value === 'true' || value === '1';
    };

    const requestPlatform = url.searchParams.get('platform') || platform;
    const requestDev = getBoolParam('dev', config.dev);
    const requestMinify = getBoolParam('minify', config.minify ?? false);
    const requestInlineSourceMap = getBoolParam(
      'inlineSourceMap',
      config.serializer?.inlineSourceMap ?? false,
    );
    const requestExcludeSource = getBoolParam('excludeSource', false);
    const requestModulesOnly = getBoolParam('modulesOnly', false);
    const requestRunModule = getBoolParam('runModule', true);
    // sourcePaths: Use client's request value (Metro-compatible)
    // 'absolute' = /Users/.../App.tsx format (Metro default)
    // 'url-server' = [metro-project]/App.tsx format
    const requestSourcePaths = (url.searchParams.get('sourcePaths') || 'absolute') as 'absolute' | 'url-server';
    // Note: lazy, shallow, unstable_transformProfile are not yet implemented
    // app parameter is informational only (not used in bundle generation)

    const platformConfig: ResolvedConfig = {
      ...config,
      platform: requestPlatform as 'ios' | 'android' | 'web',
      dev: requestDev,
      minify: requestMinify,
      serializer: {
        ...config.serializer,
        inlineSourceMap: requestInlineSourceMap,
      },
    };

    // Check if client supports multipart/mixed
    const acceptHeader = req.headers.accept || '';
    const supportsMultipart = acceptHeader === 'multipart/mixed';

    // Construct URLs for sourceMappingURL and sourceURL (Metro-compatible)
    // Use Host header from request, fallback to localhost:port
    const host = req.headers.host || `localhost:${port}`;
    
    // Metro-compatible: sourceURL uses jscSafeUrl.toJscSafeUrl() to convert the full request URL
    // Metro's parseBundleOptionsFromBundleRequestUrl.js line 87-89:
    //   const sourceUrl = jscSafeUrl.toJscSafeUrl(
    //     protocolPart + host + requestPathname + search + hash,
    //   );
    // This converts the full request URL (with all query parameters) to JSC-safe format
    // Example: 'http://localhost:8081/index.bundle?platform=ios&dev=true'
    // Note: We need to use the full URL with all parameters, not a shortened format
    // IMPORTANT: jscSafeUrl.toJscSafeUrl() is required for Chrome DevTools to properly match source maps
    // Metro uses: import * as jscSafeUrl from 'jsc-safe-url';
    const protocolPart = 'http://';
    const fullUrl = protocolPart + host + url.pathname + url.search + (url.hash || '');
    const bundleUrl = jscSafeUrl.toJscSafeUrl(fullUrl);
    
    // Metro-compatible: Use .map extension (not .bundle.map)
    // Metro uses index.map, not index.bundle.map
    // This matches Metro's sourceMappingURL format: index.bundle → index.map
    // sourceMappingURL includes all parameters (Metro-compatible)
    const mapPathname = url.pathname.replace(/\.bundle(\.js)?$/, '.map');
    const mapUrl = `http://${host}${mapPathname}${url.search}`;

    // Extract bundle name for Metro-compatible source map folder structure
    // e.g., '/index.bundle' -> 'index.bundle', '/index.bundle.js' -> 'index.bundle'
    const bundleNameMatch = url.pathname.match(/\/([^/]+\.bundle)(?:\.js)?$/);
    const bundleName = bundleNameMatch ? bundleNameMatch[1] : undefined;

    // Helper to create multipart response
    const createMultipartResponse = (bundleCode: string, _moduleCount: number) => {
      const BOUNDARY = '3beqjf3apnqeu3h5jqorms4i';
      const CRLF = '\r\n';
      const bundleBytes = Buffer.byteLength(bundleCode);
      const revisionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const response =
        'If you are seeing this, your client does not support multipart response' +
        `${CRLF}--${BOUNDARY}${CRLF}` +
        `X-Metro-Files-Changed-Count: 0${CRLF}` +
        `X-Metro-Delta-ID: ${revisionId}${CRLF}` +
        `Content-Type: application/javascript; charset=UTF-8${CRLF}` +
        `Content-Length: ${bundleBytes}${CRLF}` +
        `Last-Modified: ${new Date().toUTCString()}${CRLF}${CRLF}` +
        bundleCode +
        `${CRLF}--${BOUNDARY}--${CRLF}`;

      res.writeHead(200, {
        'Content-Type': `multipart/mixed; boundary="${BOUNDARY}"`,
        'Cache-Control': 'no-cache',
        'X-React-Native-Project-Root': config.root,
      });
      res.end(response);
    };

    // Use cached build if available
    // Create cache key that includes all relevant build parameters
    const bundleCacheKey = `${requestPlatform}:${requestDev}:${requestMinify}:${requestExcludeSource}:${requestModulesOnly}:${requestRunModule}:${requestSourcePaths}`;

    // Check cache with parameter-based key
    const cachedBuild = cachedBuilds.get(bundleCacheKey);
    if (cachedBuild) {
      // Metro-compatible: sourceURL and sourceMappingURL are already in bundle.post via getAppendScripts
      // No need to add them again here
      const bundleWithRefs = cachedBuild.code;

      if (supportsMultipart) {
        createMultipartResponse(bundleWithRefs, cachedBuild.graph?.size || 0);
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=UTF-8', // Metro-compatible: always include charset
          'Cache-Control': 'no-cache',
          'X-React-Native-Project-Root': config.root,
          // Metro-compatible: set Content-Location header when sourceUrl is available
          ...(bundleUrl ? { 'Content-Location': bundleUrl } : {}),
        });
        res.end(bundleWithRefs);
      }
      return;
    }

    // If already building for this platform with same parameters, wait for it
    const existingBuildPromise = buildingPlatforms.get(bundleCacheKey);
    if (existingBuildPromise) {
      const build = await existingBuildPromise;
      // Note: Build is already cached by the original request that started it
      // We don't need to cache it again here

      // Metro-compatible: sourceURL and sourceMappingURL are already in bundle.post via getAppendScripts
      // No need to add them again here
      const bundleWithRefs = build.code;

      if (supportsMultipart) {
        createMultipartResponse(bundleWithRefs, build.graph?.size || 0);
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=UTF-8', // Metro-compatible: always include charset
          'Cache-Control': 'no-cache',
          'X-React-Native-Project-Root': config.root,
          // Metro-compatible: set Content-Location header when sourceUrl is available
          ...(bundleUrl ? { 'Content-Location': bundleUrl } : {}),
        });
        res.end(bundleWithRefs);
      }
      return;
    }

    // Start new build
    const reporter = getTerminalReporter();
    const buildID = `${requestPlatform}-${bundleCacheKey}`;
    const entryFile = config.entry || 'index.js';
    const bundleType = 'bundle';

    // Initialize progress (will be updated as build progresses)
    reporter.updateBundleProgress(buildID, entryFile, bundleType, 0, 1);

    if (supportsMultipart) {
      // Use multipart/mixed for progress streaming
      const BOUNDARY = '3beqjf3apnqeu3h5jqorms4i';
      const CRLF = '\r\n';
      let totalCount = 0;
      let lastProgress = -1;

      res.writeHead(200, {
        'Content-Type': `multipart/mixed; boundary="${BOUNDARY}"`,
        'Cache-Control': 'no-cache',
        'X-React-Native-Project-Root': config.root,
      });

      // Initial message
      res.write('If you are seeing this, your client does not support multipart response');

      try {
        // Set buildingPlatforms before starting build to prevent race conditions
        // If multiple requests arrive concurrently, they will all wait for the same promise
        // Metro-compatible: pass sourceUrl and sourceMapUrl to buildWithGraph
        // These are added to bundle.post via getAppendScripts, ensuring they're part of the bundle structure
        // This is important for source map line number accuracy
        const buildPromise = buildWithGraph(
          platformConfig,
          (transformedFileCount, totalFileCount) => {
            totalCount = totalFileCount;

            // Metro-compatible: Use conservative progress calculation
            // Metro uses Math.pow(ratio, 2) to prevent progress from going backwards
            // This is important because onDependencyAdd increases total before numProcessed
            let progressRatio: number;
            if (transformedFileCount === totalFileCount && totalFileCount > 0) {
              // Complete: show 100%
              progressRatio = 1.0;
            } else {
              // In progress: use conservative calculation, cap at 99.9%
              const baseRatio = transformedFileCount / Math.max(totalFileCount, 10);
              progressRatio = Math.min(Math.pow(baseRatio, 2), 0.999);
            }

            const currentProgress = Math.floor(progressRatio * 100);

            // Update terminal reporter (always update, throttling is handled in reporter)
            reporter.updateBundleProgress(
              buildID,
              entryFile,
              bundleType,
              transformedFileCount,
              totalFileCount,
            );

            // Only send progress to client if it increased (to reduce network traffic)
            // Metro-compatible: Always send when complete (100%) or when progress increases
            if (currentProgress > lastProgress || totalFileCount < 10 || progressRatio === 1.0) {
              lastProgress = currentProgress;
              const chunk =
                `${CRLF}--${BOUNDARY}${CRLF}` +
                `Content-Type: application/json${CRLF}${CRLF}` +
                JSON.stringify({ done: transformedFileCount, total: totalFileCount });
              res.write(chunk);
            }
          },
          {
            excludeSource: requestExcludeSource,
            modulesOnly: requestModulesOnly,
            runModule: requestRunModule,
            bundleName,
            sourcePaths: requestSourcePaths, // Use client's request value (Metro-compatible)
            sourceUrl: bundleUrl, // Metro-compatible: passed to getAppendScripts
            sourceMapUrl: mapUrl, // Metro-compatible: passed to getAppendScripts
          },
        );

        // Set buildingPlatforms immediately to handle concurrent requests
        // Use parameter-based cache key to avoid serving stale builds
        buildingPlatforms.set(bundleCacheKey, buildPromise);
        const build = await buildPromise;
        buildingPlatforms.delete(bundleCacheKey);
        cachedBuilds.set(bundleCacheKey, build);

        if (build.graph) {
          totalCount = build.graph.size;
        }

        // Mark bundle as done in terminal reporter
        reporter.bundleDone(buildID);

        // Save build state for HMR
        saveBuildStateForHMR(requestPlatform, build);

        // Send final 100% progress message before bundle chunk (Metro-compatible)
        // This tells the client that bundling is complete and progress bar should be hidden
        const finalProgressChunk =
          `${CRLF}--${BOUNDARY}${CRLF}` +
          `Content-Type: application/json${CRLF}${CRLF}` +
          JSON.stringify({ done: totalCount, total: totalCount });
        res.write(finalProgressChunk);

        // Metro-compatible: sourceURL and sourceMappingURL are already in bundle.post via getAppendScripts
        // No need to add them again here
        const bundleWithRefs = build.code;

        const bundleBytes = Buffer.byteLength(bundleWithRefs);
        const revisionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const bundleChunk =
          `${CRLF}--${BOUNDARY}${CRLF}` +
          `X-Metro-Files-Changed-Count: ${totalCount}${CRLF}` +
          `X-Metro-Delta-ID: ${revisionId}${CRLF}` +
          `Content-Type: application/javascript; charset=UTF-8${CRLF}` +
          `Content-Length: ${bundleBytes}${CRLF}` +
          `Last-Modified: ${new Date().toUTCString()}${CRLF}${CRLF}` +
          bundleWithRefs +
          `${CRLF}--${BOUNDARY}--${CRLF}`;
        res.end(bundleChunk);
      } catch (error) {
        buildingPlatforms.delete(bundleCacheKey);
        reporter.bundleFailed(buildID);
        console.error('Build error:', error);
        res.end(`${CRLF}--${BOUNDARY}--${CRLF}`);
      }
    } else {
      // Standard response (no multipart, but still show progress)
      try {
        const buildPromise = buildWithGraph(
          platformConfig,
          (transformedFileCount, totalFileCount) => {
            // Update terminal reporter even for non-multipart requests
            reporter.updateBundleProgress(
              buildID,
              entryFile,
              bundleType,
              transformedFileCount,
              totalFileCount,
            );
          },
          {
            excludeSource: requestExcludeSource,
            modulesOnly: requestModulesOnly,
            runModule: requestRunModule,
            bundleName,
            sourcePaths: requestSourcePaths, // Use client's request value (Metro-compatible)
            sourceUrl: bundleUrl, // Metro-compatible: passed to getAppendScripts
            sourceMapUrl: mapUrl, // Metro-compatible: passed to getAppendScripts
          },
        );
        buildingPlatforms.set(bundleCacheKey, buildPromise);
        const build = await buildPromise;
        buildingPlatforms.delete(bundleCacheKey);
        cachedBuilds.set(bundleCacheKey, build);

        // Mark bundle as done in terminal reporter
        reporter.bundleDone(buildID);

        saveBuildStateForHMR(requestPlatform, build);

        // Metro-compatible: sourceURL and sourceMappingURL are already in bundle.post via getAppendScripts
        // No need to add them again here
        const bundleWithRefs = build.code;

        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=UTF-8', // Metro-compatible: always include charset
          'Cache-Control': 'no-cache',
          'X-React-Native-Project-Root': config.root,
          // Metro-compatible: set Content-Location header when sourceUrl is available
          ...(bundleUrl ? { 'Content-Location': bundleUrl } : {}),
        });
        res.end(bundleWithRefs);
      } catch (error) {
        buildingPlatforms.delete(bundleCacheKey);
        reporter.bundleFailed(buildID);
        console.error('Build error:', error);
        res.writeHead(500, { 'Content-Type': 'application/javascript' });
        res.end(`// Build error: ${error}`);
      }
    }
  } catch (error) {
    console.error('Build error:', error);
    res.writeHead(500, { 'Content-Type': 'application/javascript' });
    res.end(`// Build error: ${error}`);
  }
}

/**
 * Development server for Graph Bundler
 */

import { existsSync } from 'fs';
import { extname, resolve, sep } from 'path';

import type { ServerWebSocket } from 'bun';

import type { ResolvedConfig } from '../../config/types';
import { VERSION } from '../../index';
import { createFileWatcher, type FileWatcher } from '../file-watcher';
import { buildWithGraph } from './build';
import { createHMRUpdateMessage, incrementalBuild } from './hmr';
import type { BuildResult, HMRErrorMessage, PlatformBuildState } from './types';
import { printBanner } from './utils';

/**
 * Serve bundle using Graph bundler
 * Returns server instance for testing purposes
 */
export async function serveWithGraph(
  config: ResolvedConfig,
): Promise<{ stop: () => Promise<void> }> {
  const { platform, server } = config;
  const port = server?.port ?? 8081;
  // Use 0.0.0.0 to allow connections from Android emulator (10.0.2.2) and other devices
  const hostname = '0.0.0.0';

  // Print ASCII art banner
  printBanner(VERSION);
  console.log(`Starting dev server on http://${hostname}:${port}`);

  // Platform-aware cache: key is platform name
  const cachedBuilds = new Map<string, BuildResult>();
  const buildingPlatforms = new Map<string, Promise<BuildResult>>();

  // Track connected HMR clients and WebSocket connections
  const hmrClients = new Set<{ send: (msg: string) => void }>();
  const wsConnections = new Set<ServerWebSocket<HmrWsData>>();

  // Track build state per platform for HMR
  const platformBuildStates = new Map<string, PlatformBuildState>();

  type HmrWsData = { url: string };
  type HmrClient = { send: (msg: string) => void };
  type HmrWs = ServerWebSocket<HmrWsData> & { _client?: HmrClient };

  const httpServer = Bun.serve<HmrWsData>({
    port,
    hostname,
    idleTimeout: 120, // 2 minutes timeout for slow builds
    async fetch(req, serverInstance) {
      const url = new URL(req.url);

      // Handle WebSocket upgrade for HMR (Metro protocol)
      // React Native connects to /hot for HMR
      if (url.pathname === '/hot' || url.pathname.startsWith('/hot?')) {
        const upgraded = serverInstance.upgrade(req, {
          data: { url: url.toString() } as HmrWsData,
        });
        if (upgraded) {
          return undefined; // Bun handles the upgrade
        }
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      if (url.pathname.endsWith('.bundle') || url.pathname.endsWith('.bundle.js')) {
        try {
          // Get platform from URL query parameter (React Native passes this)
          const requestPlatform = url.searchParams.get('platform') || platform;

          // Create platform-specific config
          const platformConfig: ResolvedConfig = {
            ...config,
            platform: requestPlatform as 'ios' | 'android' | 'web',
          };

          // Check if client supports multipart/mixed (Metro-compatible)
          const acceptHeader = req.headers.get('Accept') || '';
          const supportsMultipart = acceptHeader === 'multipart/mixed';

          // Helper to create multipart response for cached/waiting builds
          const createMultipartResponse = (bundleCode: string, _moduleCount: number) => {
            const BOUNDARY = '3beqjf3apnqeu3h5jqorms4i';
            const CRLF = '\r\n';
            const bundleBytes = Buffer.byteLength(bundleCode);
            const revisionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

            // Multipart response: initial message + bundle (no separate progress for cached)
            // Metro format: preamble + bundle chunk with headers
            // X-Metro-Files-Changed-Count is 0 for cached builds (no files changed)
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

            return new Response(response, {
              headers: {
                'Content-Type': `multipart/mixed; boundary="${BOUNDARY}"`,
                'Cache-Control': 'no-cache',
              },
            });
          };

          // Construct full URLs for sourceMappingURL and sourceURL (Metro-compatible)
          // Metro uses full HTTP URLs in bundle comments:
          // - //# sourceMappingURL=http://localhost:8081/index.map?platform=ios&dev=true
          // - //# sourceURL=http://localhost:8081/index.bundle?platform=ios&dev=true
          const bundleUrl = url.origin + url.pathname + url.search;
          const mapUrl = url.origin + url.pathname.replace(/\.bundle$/, '.map') + url.search;

          // Use cached build if available (Metro-compatible: dev mode also uses cache)
          // Cache is invalidated when files change via handleFileChange
          const cachedBuild = cachedBuilds.get(requestPlatform);
          if (cachedBuild) {
            let bundleWithRefs = cachedBuild.code;
            if (cachedBuild.map) {
              bundleWithRefs += `\n//# sourceMappingURL=${mapUrl}`;
              bundleWithRefs += `\n//# sourceURL=${bundleUrl}`;
            }

            if (supportsMultipart) {
              const moduleCount = cachedBuild.graph?.size || 0;
              return createMultipartResponse(bundleWithRefs, moduleCount);
            }

            return new Response(bundleWithRefs, {
              headers: {
                'Content-Type': 'application/javascript',
                'Cache-Control': 'no-cache',
              },
            });
          }

          // If already building for this platform, wait for it
          const existingBuildPromise = buildingPlatforms.get(requestPlatform);
          if (existingBuildPromise) {
            const build = await existingBuildPromise;
            cachedBuilds.set(requestPlatform, build);

            let bundleWithRefs2 = build.code;
            if (build.map) {
              bundleWithRefs2 += `\n//# sourceMappingURL=${mapUrl}`;
              bundleWithRefs2 += `\n//# sourceURL=${bundleUrl}`;
            }

            if (supportsMultipart) {
              const moduleCount = build.graph?.size || 0;
              return createMultipartResponse(bundleWithRefs2, moduleCount);
            }

            return new Response(bundleWithRefs2, {
              headers: {
                'Content-Type': 'application/javascript',
                'Cache-Control': 'no-cache',
              },
            });
          }

          // Start new build for this platform
          console.log(`Building ${requestPlatform} bundle...`);

          if (supportsMultipart) {
            // Use multipart/mixed for progress streaming (Metro-compatible)
            const BOUNDARY = '3beqjf3apnqeu3h5jqorms4i';
            const CRLF = '\r\n';
            const encoder = new TextEncoder();
            let totalCount = 0;
            let lastProgress = -1;

            const stream = new ReadableStream({
              async start(controller) {
                try {
                  // Initial message for clients that don't support multipart
                  controller.enqueue(
                    encoder.encode(
                      'If you are seeing this, your client does not support multipart response',
                    ),
                  );

                  // Build with progress callbacks
                  const buildPromise = buildWithGraph(
                    platformConfig,
                    (transformedFileCount, totalFileCount) => {
                      totalCount = totalFileCount;

                      // Throttle: only send when percentage changes (Metro behavior)
                      const currentProgress = Math.floor(
                        (transformedFileCount / totalFileCount) * 100,
                      );
                      if (currentProgress <= lastProgress && totalFileCount >= 10) {
                        return;
                      }
                      lastProgress = currentProgress;

                      // Metro format: writeChunk with Content-Type header
                      const chunk =
                        `${CRLF}--${BOUNDARY}${CRLF}` +
                        `Content-Type: application/json${CRLF}${CRLF}` +
                        JSON.stringify({ done: transformedFileCount, total: totalFileCount });
                      controller.enqueue(encoder.encode(chunk));
                    },
                  );

                  buildingPlatforms.set(requestPlatform, buildPromise);
                  const build = await buildPromise;
                  buildingPlatforms.delete(requestPlatform);
                  cachedBuilds.set(requestPlatform, build);

                  // Ensure totalCount is set from actual graph size
                  if (build.graph) {
                    totalCount = build.graph.size;
                  }

                  // Save build state for HMR
                  if (config.dev && build.graph && build.createModuleId) {
                    try {
                      const { graph, createModuleId } = build;
                      const moduleIdToPath = new Map<number | string, string>();
                      const pathToModuleId = new Map<string, number | string>();
                      for (const [path] of graph.entries()) {
                        const moduleId = createModuleId(path);
                        moduleIdToPath.set(moduleId, path);
                        pathToModuleId.set(path, moduleId);
                      }
                      const revisionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
                      platformBuildStates.set(requestPlatform, {
                        graph,
                        moduleIdToPath,
                        pathToModuleId,
                        revisionId,
                        createModuleId,
                      });
                    } catch (error) {
                      console.warn(`Failed to save build state for HMR:`, error);
                    }
                  }

                  // Construct full URLs for sourceMappingURL and sourceURL (Metro-compatible)
                  let bundleWithRefs = build.code;
                  if (build.map) {
                    bundleWithRefs += `\n//# sourceMappingURL=${mapUrl}`;
                    bundleWithRefs += `\n//# sourceURL=${bundleUrl}`;
                  }

                  // Final chunk with bundle code (Metro format)
                  // Metro sends: X-Metro-Files-Changed-Count, X-Metro-Delta-ID, Content-Type, Content-Length, Last-Modified
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
                  controller.enqueue(encoder.encode(bundleChunk));
                  controller.close();
                } catch (error) {
                  buildingPlatforms.delete(requestPlatform);
                  controller.error(error);
                }
              },
            });

            return new Response(stream, {
              headers: {
                'Content-Type': `multipart/mixed; boundary="${BOUNDARY}"`,
                'Cache-Control': 'no-cache',
              },
            });
          }

          // Standard response (no multipart support)
          const buildPromise = buildWithGraph(platformConfig);
          buildingPlatforms.set(requestPlatform, buildPromise);
          const build = await buildPromise;
          buildingPlatforms.delete(requestPlatform);
          cachedBuilds.set(requestPlatform, build);

          // Save build state for HMR
          if (config.dev && build.graph && build.createModuleId) {
            try {
              const { graph, createModuleId } = build;
              const moduleIdToPath = new Map<number | string, string>();
              const pathToModuleId = new Map<string, number | string>();
              for (const [path] of graph.entries()) {
                const moduleId = createModuleId(path);
                moduleIdToPath.set(moduleId, path);
                pathToModuleId.set(path, moduleId);
              }
              const revisionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
              platformBuildStates.set(requestPlatform, {
                graph,
                moduleIdToPath,
                pathToModuleId,
                revisionId,
                createModuleId,
              });
            } catch (error) {
              console.warn(`Failed to save build state for HMR:`, error);
            }
          }

          let bundleWithRefs3 = build.code;
          if (build.map) {
            bundleWithRefs3 += `\n//# sourceMappingURL=${mapUrl}`;
            bundleWithRefs3 += `\n//# sourceURL=${bundleUrl}`;
          }

          return new Response(bundleWithRefs3, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache',
            },
          });
        } catch (error) {
          console.error('Build error:', error);
          return new Response(`// Build error: ${error}`, {
            status: 500,
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
      }

      if (url.pathname === '/status' || url.pathname === '/status.txt') {
        return new Response('packager-status:running', {
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      // Handle /open-url endpoint (Metro-compatible)
      // This endpoint is used by openURLInBrowser to open URLs in the default browser
      // Metro format: POST /open-url with body: { url: "https://..." }
      if (url.pathname === '/open-url') {
        if (req.method === 'POST') {
          try {
            const body = (await req.json()) as { url?: string };
            const targetUrl = body?.url;
            if (targetUrl && typeof targetUrl === 'string') {
              // Open URL in default browser
              // Use Bun's built-in spawn for cross-platform support
              let command: string;
              let args: string[];

              if (process.platform === 'win32') {
                // Windows: use start command
                command = 'cmd';
                args = ['/c', 'start', '', targetUrl];
              } else if (process.platform === 'darwin') {
                // macOS: use open command
                command = 'open';
                args = [targetUrl];
              } else {
                // Linux and others: use xdg-open
                command = 'xdg-open';
                args = [targetUrl];
              }

              // Spawn process in background (detached) to avoid blocking
              // Bun.spawn takes command and args separately
              const proc = Bun.spawn([command, ...args], {
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
              });
              // Don't wait for the process to complete
              proc.unref();

              console.log(`Opening URL in browser: ${targetUrl}`);
              return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' },
              });
            } else {
              return new Response(JSON.stringify({ error: 'Invalid URL' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          } catch (error) {
            console.error('Error opening URL:', error);
            return new Response(JSON.stringify({ error: 'Failed to open URL' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } else {
          return new Response('Method Not Allowed', { status: 405 });
        }
      }

      // Handle /symbolicate endpoint (Metro-compatible)
      // React Native LogBox calls this endpoint to symbolicate stack traces
      if (url.pathname === '/symbolicate') {
        if (req.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405 });
        }

        try {
          // Parse request body
          const body = (await req.json()) as {
            stack?: Array<{
              file?: string;
              lineNumber?: number;
              column?: number;
              methodName?: string;
            }>;
            extraData?: any;
          };
          const stack: Array<{
            file?: string;
            lineNumber?: number;
            column?: number;
            methodName?: string;
          }> = body.stack || [];
          // extraData is available for future use (Metro-compatible)
          const _extraData = body.extraData || {};

          // Get source map from cached build
          // Extract bundle URL from stack frames to determine platform
          const bundleUrl = stack.find((frame) => frame.file?.includes('.bundle'))?.file;
          let mapPlatform = platform;
          if (bundleUrl) {
            try {
              const urlObj = new URL(bundleUrl);
              const platformParam = urlObj.searchParams.get('platform');
              if (platformParam) {
                mapPlatform = platformParam as 'ios' | 'android' | 'web';
              }
            } catch {
              // Invalid URL, use default platform
            }
          }

          const cachedBuild = cachedBuilds.get(mapPlatform);
          if (!cachedBuild?.map) {
            // No source map available, return stack as-is
            return new Response(
              JSON.stringify({
                stack: stack.map((frame) => ({
                  ...frame,
                })),
                codeFrame: null,
              }),
              {
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          // Load source map and symbolicate
          const metroSourceMap = await import('metro-source-map');
          const { Consumer } = metroSourceMap;
          const sourceMap = JSON.parse(cachedBuild.map);
          const consumer = new Consumer(sourceMap);

          // Symbolicate each frame
          const symbolicatedStack = stack.map((frame) => {
            if (!frame.file || frame.lineNumber == null) {
              return { ...frame };
            }

            // Extract bundle URL from frame.file (e.g., "http://localhost:8081/index.bundle?platform=ios&dev=true")
            // We need to match this to our source map
            try {
              const originalPos = consumer.originalPositionFor({
                line: frame.lineNumber as any, // metro-source-map uses ob1 types internally
                column: (frame.column ?? 0) as any,
              });

              if (originalPos.source == null || originalPos.line == null) {
                // No mapping found, return frame as-is
                return { ...frame };
              }

              // Resolve source path relative to project root
              const sourcePath = originalPos.source.startsWith('/')
                ? originalPos.source
                : resolve(config.root, originalPos.source);

              // Convert ob1 types to numbers
              const originalLine =
                typeof originalPos.line === 'number' ? originalPos.line : Number(originalPos.line);
              const originalColumn =
                typeof originalPos.column === 'number'
                  ? originalPos.column
                  : Number(originalPos.column ?? 0);

              return {
                ...frame,
                file: sourcePath,
                lineNumber: originalLine,
                column: originalColumn,
                methodName: originalPos.name ?? frame.methodName,
              };
            } catch {
              // Symbolication failed, return frame as-is
              return { ...frame };
            }
          });

          // Generate code frame for first frame with valid source
          let codeFrame: {
            content: string;
            location: { row: number; column: number };
            fileName: string;
          } | null = null;
          const { readFileSync } = await import('fs');
          for (const frame of symbolicatedStack) {
            if (frame.file && frame.lineNumber != null && !frame.file.includes('.bundle')) {
              try {
                const sourceCode = readFileSync(frame.file, 'utf-8');
                const lines = sourceCode.split('\n');
                const targetLine = (frame.lineNumber ?? 1) - 1;
                if (targetLine >= 0 && targetLine < lines.length) {
                  const column = frame.column ?? 0;
                  // Simple code frame (Metro uses @babel/code-frame for better formatting)
                  const startLine = Math.max(0, targetLine - 2);
                  const endLine = Math.min(lines.length - 1, targetLine + 2);
                  const context = lines.slice(startLine, endLine + 1);
                  const pointer = ' '.repeat(Math.max(0, column)) + '^';
                  codeFrame = {
                    content: context.join('\n') + '\n' + pointer,
                    location: {
                      row: frame.lineNumber ?? 1,
                      column: frame.column ?? 0,
                    },
                    fileName: frame.file,
                  };
                  break;
                }
              } catch {
                // Failed to read file, continue to next frame
              }
            }
          }

          return new Response(
            JSON.stringify({
              stack: symbolicatedStack,
              codeFrame,
            }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          );
        } catch (error) {
          console.error('Symbolication failed:', error);
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
      }

      if (url.pathname.endsWith('.map')) {
        // Get platform from URL query parameter for sourcemap
        const mapPlatform = url.searchParams.get('platform') || platform;
        const cachedBuild = cachedBuilds.get(mapPlatform);
        if (cachedBuild?.map) {
          return new Response(cachedBuild.map, {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Handle asset requests (Metro-compatible)
      // Metro serves assets over HTTP in dev mode (not copied to filesystem)
      // Metro URL format: httpServerLocation + '/' + name + '@' + scale + '.' + type
      // Metro generates: /assets/../../node_modules/.../react-light.png
      // HTTP clients (OkHttp) normalize relative paths (../), so requests may come as:
      // - /assets/../../node_modules/... (original)
      // - /node_modules/... (normalized by HTTP client)
      // We need to handle both cases
      const isAssetRequest =
        url.pathname.startsWith('/assets/') || url.pathname.startsWith('/node_modules/');
      if (isAssetRequest) {
        try {
          // Handle both /assets/... and /node_modules/... paths
          let assetRelativePath: string;
          if (url.pathname.startsWith('/assets/')) {
            // Remove /assets/ prefix
            assetRelativePath = url.pathname.slice('/assets/'.length);
            // Metro behavior: httpServerLocation can contain relative paths like "../../node_modules/..."
            // These are relative to project root. We need to resolve them correctly.
            // Example: "../../node_modules/.../assets/react-light.png"
            // Use path.resolve to properly handle ../ segments
            // First, normalize the path by removing leading ../ and resolving
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
            // HTTP client normalized /assets/../../node_modules/... to /node_modules/...
            // This is already an absolute path from project root
            assetRelativePath = url.pathname.slice('/node_modules/'.length);
            // Prepend node_modules/ to make it relative to project root
            assetRelativePath = `node_modules/${assetRelativePath}`;
          } else {
            return new Response('Bad Request', { status: 400 });
          }

          // Remove scale suffix if present (e.g., react-light@2x.png -> react-light.png)
          // Metro adds @scale suffix for scaled assets, but we need the original file
          assetRelativePath = assetRelativePath.replace(/@\d+x\./, '.');

          // Normalize path separators: convert any backslashes to forward slashes (Windows compatibility)
          assetRelativePath = assetRelativePath.replace(/\\/g, '/');

          // Convert forward slashes to platform-specific separators for file system access
          const normalizedPath = assetRelativePath.replace(/\//g, sep);

          // Try resolving from project root first
          let resolvedAssetPath = resolve(config.root, normalizedPath);

          // If not found, try from monorepo node_modules paths
          if (!existsSync(resolvedAssetPath)) {
            for (const nodeModulesPath of config.resolver.nodeModulesPaths) {
              const monorepoPath = resolve(config.root, nodeModulesPath);
              // Try resolving from monorepo root
              const alternativePath = resolve(monorepoPath, '..', normalizedPath);
              if (existsSync(alternativePath)) {
                resolvedAssetPath = alternativePath;
                break;
              }
            }
          }

          // Use resolved path (rename to avoid variable shadowing)
          const finalAssetPath = resolvedAssetPath;

          // Security: Ensure the resolved path is within allowed directories
          const normalizedAssetPath = resolve(finalAssetPath);
          const normalizedRoot = resolve(config.root);

          // Check if path is within project root
          let isAllowed = normalizedAssetPath.startsWith(normalizedRoot);

          // Also check monorepo node_modules paths
          if (!isAllowed) {
            isAllowed = config.resolver.nodeModulesPaths.some((p) => {
              const monorepoNodeModules = resolve(config.root, p);
              return normalizedAssetPath.startsWith(monorepoNodeModules);
            });
          }

          if (!isAllowed) {
            console.warn(`Asset path outside allowed directories: ${normalizedAssetPath}`);
            return new Response('Forbidden', { status: 403 });
          }

          // Check if file exists
          if (!existsSync(normalizedAssetPath)) {
            console.warn(`Asset not found: ${normalizedAssetPath} (requested: ${url.pathname})`);
            return new Response('Not Found', { status: 404 });
          }

          // Read and serve the asset file
          const file = Bun.file(finalAssetPath);
          const ext = extname(normalizedAssetPath).toLowerCase();

          // Determine content type based on extension
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

          return new Response(file, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000', // Cache assets for 1 year
            },
          });
        } catch (error) {
          console.error(`Error serving asset ${url.pathname}:`, error);
          return new Response('Internal Server Error', { status: 500 });
        }
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bungae Dev Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 30px;
      background: #fafafa;
    }
    
    h1 {
      font-size: 28px;
      margin-bottom: 8px;
      font-weight: 600;
      color: #222;
    }
    
    h2 {
      font-size: 18px;
      margin: 30px 0 15px 0;
      font-weight: 600;
      color: #444;
      padding-bottom: 8px;
      border-bottom: 2px solid #e0e0e0;
    }
    
    p {
      margin: 8px 0;
      color: #666;
    }
    
    a {
      color: #007aff;
      text-decoration: none;
    }
    
    a:hover {
      color: #0051d5;
      text-decoration: underline;
    }
    
    ul {
      list-style: none;
      padding: 0;
      margin: 15px 0;
    }
    
    li {
      margin: 10px 0;
      padding: 8px 0;
    }
    
    code {
      background: #f0f0f0;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      color: #333;
      border: 1px solid #e0e0e0;
    }
    
    a code {
      background: #e8f4fd;
      border-color: #007aff;
      color: #007aff;
    }
    
    a:hover code {
      background: #d0e9fc;
    }
  </style>
</head>
<body>
  <h1>Bungae Dev Server</h1>
  <p>Lightning Fast React Native Bundler v${VERSION}</p>
  
  <h2>Bundles</h2>
  <ul>
    <li><a href="/index.bundle?platform=ios&dev=true"><code>/index.bundle?platform=ios&dev=true</code></a></li>
    <li><a href="/index.bundle?platform=android&dev=true"><code>/index.bundle?platform=android&dev=true</code></a></li>
  </ul>
  
  <h2>Source Maps</h2>
  <ul>
    <li><a href="/index.bundle.map?platform=ios"><code>/index.bundle.map?platform=ios</code></a></li>
    <li><a href="/index.bundle.map?platform=android"><code>/index.bundle.map?platform=android</code></a></li>
  </ul>
  
  <h2>HMR</h2>
  <ul>
    <li><a href="/hot"><code>ws://localhost:${port}/hot</code></a></li>
  </ul>
</body>
</html>`;
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return new Response('Not Found', { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<HmrWsData>) {
        console.log('[HMR] Client connected');
        wsConnections.add(ws);
        const client: HmrClient = {
          send: (msg: string) => {
            try {
              ws.send(msg);
            } catch {
              // Client disconnected
            }
          },
        };
        hmrClients.add(client);
        // Store reference on ws for cleanup
        (ws as HmrWs)._client = client;
      },
      message(ws, message) {
        try {
          const msg = JSON.parse(message.toString());

          // Handle Metro HMR protocol messages
          switch (msg.type) {
            case 'register-entrypoints':
              // Client is registering after bundle load
              // Send bundle-registered to dismiss loading overlay
              console.log('[HMR] Sending bundle-registered');
              ws.send(JSON.stringify({ type: 'bundle-registered' }));
              break;

            case 'log':
              // Client is sending log messages (Metro format)
              // Metro log format: { type: 'log', level: 'log'|'warn'|'error'|'info', mode: 'BRIDGE', data: [...args] }
              // The data is at msg.data, not msg.body
              if (msg.data && Array.isArray(msg.data)) {
                const level = msg.level || 'log';
                console.log(`[HMR Client ${level}]`, ...msg.data);
              } else if (msg.body) {
                console.log('[HMR Client]', JSON.stringify(msg.body));
              } else {
                // Fallback: print raw message
                console.log('[HMR Client raw]', JSON.stringify(msg));
              }
              break;

            case 'log-opt-in':
              // Client wants to receive log forwarding
              break;

            default:
              console.log('[HMR] Unknown message type:', msg.type);
          }
        } catch (error) {
          console.error('[HMR] Error parsing message:', error);
        }
      },
      close(ws: ServerWebSocket<HmrWsData>) {
        console.log('[HMR] Client disconnected');
        wsConnections.delete(ws);
        const client = (ws as HmrWs)._client;
        if (client) {
          hmrClients.delete(client);
        }
      },
    },
  });

  console.log(`\n✅ Dev server running at http://${hostname}:${port}`);
  console.log(`   HMR endpoint: ws://${hostname}:${port}/hot`);

  // File watcher for auto-rebuild on file changes (dev mode only)
  let fileWatcher: FileWatcher | null = null;
  if (config.dev) {
    const handleFileChange = async (changedFiles: string[] = []) => {
      console.log('File changed, invalidating cache and triggering HMR update...');

      // Always invalidate cache when files change (Metro-compatible)
      // This ensures next bundle request will use latest code
      for (const platformKey of cachedBuilds.keys()) {
        cachedBuilds.delete(platformKey);
        console.log(`Invalidated cache for ${platformKey}`);
      }

      // Check if we have any build states
      if (platformBuildStates.size === 0) {
        console.log('No build states available yet. Waiting for initial build...');
        return;
      }

      // Check if we have any connected clients
      if (hmrClients.size === 0) {
        console.log('No HMR clients connected. Cache invalidated, will rebuild on next request.');
        return;
      }

      // Track changed files for each platform
      const changedFilesSet = new Set(changedFiles);

      console.log(
        `Processing HMR update for ${platformBuildStates.size} platform(s), ${hmrClients.size} client(s) connected`,
      );

      // Process each platform that has been built
      for (const [platformKey, oldState] of platformBuildStates.entries()) {
        try {
          // Create platform-specific config
          const platformConfig: ResolvedConfig = {
            ...config,
            platform: platformKey as 'ios' | 'android' | 'web',
          };

          // Perform incremental build
          const result = await incrementalBuild(
            Array.from(changedFilesSet),
            oldState,
            platformConfig,
          );

          if (!result) {
            console.warn(
              `Incremental build failed for ${platformKey}, falling back to full rebuild`,
            );
            // Fallback: invalidate cache
            cachedBuilds.delete(platformKey);
            buildingPlatforms.delete(platformKey);
            continue;
          }

          const { delta, newState } = result;

          // Check if there are any changes
          if (delta.added.size === 0 && delta.modified.size === 0 && delta.deleted.size === 0) {
            console.log(`No changes detected for ${platformKey}`);
            continue;
          }

          // Update build state
          platformBuildStates.set(platformKey, newState);

          // Create HMR update message
          const hmrMessage = await createHMRUpdateMessage(
            delta,
            platformConfig,
            newState.createModuleId,
            newState.revisionId,
            false, // isInitialUpdate
            oldState.pathToModuleId,
            newState.graph, // Full graph for inverse dependencies
          );

          // Send HMR update to all connected clients (Metro protocol)
          // Metro sends: update-start → update → update-done
          const sendToClients = (msg: object, msgType: string) => {
            if (hmrClients.size === 0) {
              console.warn(`No HMR clients connected, cannot send ${msgType}`);
              return;
            }
            const messageStr = JSON.stringify(msg);
            let sentCount = 0;
            for (const client of hmrClients) {
              try {
                client.send(messageStr);
                sentCount++;
              } catch (error) {
                console.error(`Error sending ${msgType}:`, error);
              }
            }
            console.log(`Sent ${msgType} to ${sentCount} client(s)`);
          };

          // Send update-start (Metro-compatible)
          // Metro format: {type: 'update-start', body: {isInitialUpdate: boolean}}
          sendToClients(
            {
              type: 'update-start',
              body: {
                isInitialUpdate: false,
              },
            },
            'update-start',
          );

          // Send update message
          // Debug: Log actual JSON being sent (only in dev mode)
          if (config.dev) {
            // Validate the message structure before sending
            if (!hmrMessage.body) {
              console.error('CRITICAL: hmrMessage.body is missing!', hmrMessage);
            } else {
              // Ensure arrays are always present (Metro's mergeUpdates requires them)
              // Metro client receives data.body directly as update, so body must have these arrays
              if (!Array.isArray(hmrMessage.body.added)) {
                console.error(
                  'CRITICAL: hmrMessage.body.added is not an array!',
                  typeof hmrMessage.body.added,
                  hmrMessage.body.added,
                );
                // Fix it
                hmrMessage.body.added = [];
              }
              if (!Array.isArray(hmrMessage.body.modified)) {
                console.error(
                  'CRITICAL: hmrMessage.body.modified is not an array!',
                  typeof hmrMessage.body.modified,
                  hmrMessage.body.modified,
                );
                // Fix it
                hmrMessage.body.modified = [];
              }
              if (!Array.isArray(hmrMessage.body.deleted)) {
                console.error(
                  'CRITICAL: hmrMessage.body.deleted is not an array!',
                  typeof hmrMessage.body.deleted,
                  hmrMessage.body.deleted,
                );
                // Fix it
                hmrMessage.body.deleted = [];
              }
            }
          }

          // Final validation: Ensure body structure is correct before sending
          // Metro's mergeUpdates expects: update.added, update.modified, update.deleted to be arrays
          // Metro client receives data.body directly as update, so body must have these arrays
          if (!hmrMessage.body) {
            console.error('CRITICAL: Cannot send HMR update - body is missing!');
            return;
          }
          // Double-check arrays (defensive programming)
          if (!Array.isArray(hmrMessage.body.added)) {
            hmrMessage.body.added = [];
          }
          if (!Array.isArray(hmrMessage.body.modified)) {
            hmrMessage.body.modified = [];
          }
          if (!Array.isArray(hmrMessage.body.deleted)) {
            hmrMessage.body.deleted = [];
          }

          sendToClients(hmrMessage, 'update');

          // Send update-done (Metro-compatible)
          sendToClients(
            {
              type: 'update-done',
            },
            'update-done',
          );

          console.log(
            `HMR update sent for ${platformKey}: ${delta.added.size} added, ` +
              `${delta.modified.size} modified, ${delta.deleted.size} deleted`,
          );

          // Invalidate cache to force full rebuild on next request (if needed)
          cachedBuilds.delete(platformKey);
        } catch (error) {
          console.error(`Error processing HMR update for ${platformKey}:`, error);

          // Send error message to clients
          const errorMessage: HMRErrorMessage = {
            type: 'error',
            body: {
              type: 'BuildError',
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          };

          const errorStr = JSON.stringify(errorMessage);
          for (const client of hmrClients) {
            try {
              client.send(errorStr);
            } catch (sendError) {
              console.error('Error sending HMR error:', sendError);
            }
          }

          // Fallback: invalidate cache
          cachedBuilds.delete(platformKey);
          buildingPlatforms.delete(platformKey);
        }
      }
    };

    fileWatcher = createFileWatcher({
      root: config.root,
      onFileChange: (changedFilesArr) => {
        handleFileChange(changedFilesArr);
      },
      debounceMs: 300,
    });
  }

  // Handle graceful shutdown on SIGINT (Ctrl+C) and SIGTERM
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    const isTestMode = process.env.NODE_ENV === 'test' || (globalThis as any).__BUNGAE_TEST_MODE__;
    if (!isTestMode) {
      console.log(`\n${signal} received, shutting down dev server...`);
    }

    try {
      // Close file watcher (if it was created)
      if (fileWatcher) {
        fileWatcher.close();
      }

      // Close all WebSocket connections
      for (const ws of wsConnections) {
        try {
          ws.close();
        } catch {
          // Ignore errors when closing
        }
      }
      wsConnections.clear();
      hmrClients.clear();

      // Stop the server
      await httpServer.stop();
      if (!isTestMode) {
        console.log('Server stopped');
      }

      // Only exit if not in test mode (test mode will call stop() directly)
      if (!isTestMode) {
        process.exit(0);
      }
    } catch (error) {
      if (!isTestMode) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
      // In test mode, just throw the error
      throw error;
    }
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => {
      console.error('Shutdown error:', err);
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => {
      console.error('Shutdown error:', err);
      process.exit(1);
    });
  });

  // Keep the process alive - Bun.serve keeps the event loop running
  // Return server instance for testing purposes
  return {
    stop: async () => {
      // Close file watcher first
      if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
      }

      // Close all WebSocket connections
      for (const ws of wsConnections) {
        try {
          ws.close();
        } catch {
          // Ignore errors when closing
        }
      }
      wsConnections.clear();
      hmrClients.clear();

      // Stop the server
      try {
        await httpServer.stop();
      } catch {
        // Ignore errors - server might already be stopped
      }
    },
  };
}

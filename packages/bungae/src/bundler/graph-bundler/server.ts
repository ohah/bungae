/**
 * Development server for Graph Bundler
 * Uses Node.js http.createServer() for full @react-native/dev-middleware compatibility
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http';
import { extname, resolve, sep } from 'path';
import type { Duplex } from 'stream';

// Import React Native CLI server API for message socket (reload/devMenu)
import { createDevServerMiddleware } from '@react-native-community/cli-server-api';
// Import WebSocket server from ws module (used by dev-middleware)
import { WebSocketServer, type WebSocket } from 'ws';

import type { ResolvedConfig } from '../../config/types';
import { VERSION } from '../../index';
import { createFileWatcher, type FileWatcher } from '../file-watcher';
import { buildWithGraph } from './build';
import { createHMRUpdateMessage, incrementalBuild } from './hmr';
import { setupTerminalActions } from './terminal-actions';
import type { BuildResult, HMRErrorMessage, PlatformBuildState } from './types';
import { printBanner } from './utils';

/**
 * Type for dev middleware (dynamically loaded)
 */
interface DevMiddleware {
  middleware: (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => void;
  websocketEndpoints: Record<
    string,
    {
      handleUpgrade: (
        req: IncomingMessage,
        socket: Duplex,
        head: Buffer,
        callback: (ws: WebSocket) => void,
      ) => void;
      emit: (event: string, ws: WebSocket, req: IncomingMessage) => void;
    }
  >;
}

/**
 * Try to load @react-native/dev-middleware
 */
async function loadDevMiddleware(port: number, projectRoot: string): Promise<DevMiddleware | null> {
  try {
    // Dynamic import - types are available from installed package
    const devMiddlewareModule = (await import('@react-native/dev-middleware')) as {
      createDevMiddleware: (options: {
        serverBaseUrl: string;
        projectRoot?: string;
        logger?: {
          info?: (...args: unknown[]) => void;
          warn?: (...args: unknown[]) => void;
          error?: (...args: unknown[]) => void;
        };
        unstable_experiments?: {
          enableNetworkInspector?: boolean;
        };
      }) => DevMiddleware;
    };
    const { createDevMiddleware } = devMiddlewareModule;

    // Use localhost for serverBaseUrl (this is what React Native app connects to)
    const serverBaseUrl = `http://localhost:${port}`;

    const devMiddleware = createDevMiddleware({
      serverBaseUrl,
      projectRoot,
      logger: {
        info: (...args: unknown[]) => {
          // Filter out noisy messages
          const msg = args.join(' ');
          if (msg.includes('JavaScript logs have moved')) return;
          console.log('[DevTools]', ...args);
        },
        warn: (...args: unknown[]) => console.warn('[DevTools]', ...args),
        error: (...args: unknown[]) => console.error('[DevTools]', ...args),
      },
      unstable_experiments: {
        enableNetworkInspector: true,
      },
    });

    console.log('✅ @react-native/dev-middleware loaded - DevTools support enabled');

    return devMiddleware;
  } catch (error) {
    console.warn(
      '⚠️ @react-native/dev-middleware not available - DevTools support disabled',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Parse URL from incoming request
 */
function parseRequestUrl(req: IncomingMessage, hostname: string, port: number): URL {
  const protocol = 'http';
  const host = req.headers.host || `${hostname}:${port}`;
  return new URL(req.url || '/', `${protocol}://${host}`);
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Send text response
 */
function sendText(
  res: ServerResponse,
  statusCode: number,
  text: string,
  contentType = 'text/plain',
): void {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Read request body as JSON
 */
async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

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

  // Load @react-native/dev-middleware for DevTools support
  const devMiddleware = await loadDevMiddleware(port, config.root);

  // Log dev-middleware websocket endpoints
  if (devMiddleware) {
    console.log('   DevTools endpoints:', Object.keys(devMiddleware.websocketEndpoints).join(', '));
  }

  // Dev middleware paths that should be handled by dev-middleware
  // Note: Match any path starting with /json to support /json/client, /json/list, etc.
  const devMiddlewarePathPrefixes = [
    '/json',
    '/open-debugger',
    '/debugger-frontend',
    '/launch-js-devtools',
  ];

  // Create React Native CLI server middleware (provides message socket for reload/devMenu)
  const {
    middleware: _cliMiddleware,
    websocketEndpoints: cliWebsocketEndpoints,
    messageSocketEndpoint,
  } = createDevServerMiddleware({
    port,
    host: hostname,
    watchFolders: [config.root],
  });

  // Get broadcast function from message socket (Metro-compatible)
  const broadcast = messageSocketEndpoint.broadcast;

  // Log CLI server middleware endpoints
  console.log('   CLI endpoints:', Object.keys(cliWebsocketEndpoints).join(', '));

  // Platform-aware cache: key is platform name
  const cachedBuilds = new Map<string, BuildResult>();
  const buildingPlatforms = new Map<string, Promise<BuildResult>>();
  // Cache source map Consumers per platform for symbolication performance
  const sourceMapConsumers = new Map<string, any>();

  // Track connected HMR clients
  const hmrClients = new Set<{ send: (msg: string) => void }>();

  // Track build state per platform for HMR
  const platformBuildStates = new Map<string, PlatformBuildState>();

  // Create WebSocket server for HMR
  const hmrWss = new WebSocketServer({ noServer: true });

  // HMR WebSocket handlers
  hmrWss.on('connection', (ws: WebSocket) => {
    console.log('[HMR] Client connected');
    const client = {
      send: (msg: string) => {
        try {
          ws.send(msg);
        } catch {
          // Client disconnected
        }
      },
    };
    hmrClients.add(client);

    ws.on('message', (message: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(message.toString());
        switch (msg.type) {
          case 'register-entrypoints':
            console.log('[HMR] Sending bundle-registered');
            ws.send(JSON.stringify({ type: 'bundle-registered' }));
            break;
          case 'log':
            // Client log forwarding disabled - use DevTools console instead
            break;
          case 'log-opt-in':
            break;
          default:
            console.log('[HMR] Unknown message type:', msg.type);
        }
      } catch (error) {
        console.error('[HMR] Error parsing message:', error);
      }
    });

    ws.on('close', () => {
      console.log('[HMR] Client disconnected');
      hmrClients.delete(client);
    });
  });

  // Message socket is handled by @react-native-community/cli-server-api
  // via cliWebsocketEndpoints (includes /message endpoint)

  /**
   * Handle HTTP requests
   */
  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = parseRequestUrl(req, hostname, port);

    // Handle dev-middleware paths for DevTools support
    if (devMiddleware) {
      const shouldHandleByDevMiddleware = devMiddlewarePathPrefixes.some(
        (prefix: string) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'),
      );

      if (shouldHandleByDevMiddleware) {
        return new Promise<void>((resolve) => {
          devMiddleware.middleware(req, res, () => {
            // If dev-middleware doesn't handle it, continue to our handlers
            resolve();
          });
        }).then(() => {
          if (!res.headersSent) {
            handleOurRoutes(req, res, url);
          }
        });
      }
    }

    await handleOurRoutes(req, res, url);
  };

  /**
   * Handle our custom routes
   */
  const handleOurRoutes = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> => {
    // Bundle request
    if (url.pathname.endsWith('.bundle') || url.pathname.endsWith('.bundle.js')) {
      await handleBundleRequest(req, res, url);
      return;
    }

    // Status endpoint
    if (url.pathname === '/status' || url.pathname === '/status.txt') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'X-React-Native-Project-Root': config.root,
      });
      res.end('packager-status:running');
      return;
    }

    // Reload endpoint
    if (url.pathname === '/reload') {
      broadcast('reload');
      sendText(res, 200, 'OK');
      return;
    }

    // Dev menu endpoint
    if (url.pathname === '/devmenu') {
      broadcast('devMenu');
      sendText(res, 200, 'OK');
      return;
    }

    // Open URL endpoint
    if (url.pathname === '/open-url' && req.method === 'POST') {
      await handleOpenUrl(req, res);
      return;
    }

    // Symbolicate endpoint
    if (url.pathname === '/symbolicate' && req.method === 'POST') {
      await handleSymbolicate(req, res, url);
      return;
    }

    // Source map request
    if (url.pathname.endsWith('.map')) {
      await handleSourceMapRequest(res, url);
      return;
    }

    // Asset request
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/node_modules/')) {
      handleAssetRequest(res, url);
      return;
    }

    // Metro-compatible: Handle source file requests from source maps
    // Metro uses [metro-project]/ and [metro-watchFolders]/0/ prefixes
    // __prelude__ is a virtual module, so return 404 for direct requests
    if (url.pathname === '/__prelude__' || url.pathname.startsWith('/__prelude__/')) {
      sendText(res, 404, 'Cannot GET /__prelude__');
      return;
    }

    // Build source request routing map (Metro-compatible)
    const sourceRequestRoutingMap: Array<[string, string]> = [
      ['/[metro-project]/', resolve(config.root)],
    ];
    for (let i = 0; i < config.resolver.nodeModulesPaths.length; i++) {
      const nodeModulesPath = config.resolver.nodeModulesPaths[i];
      if (nodeModulesPath) {
        const absolutePath = resolve(config.root, nodeModulesPath);
        sourceRequestRoutingMap.push([`/[metro-watchFolders]/${i}/`, absolutePath]);
      }
    }

    // Check if request matches any source routing prefix
    // Note: Query parameters are ignored for source file requests (Metro-compatible)
    let handled = false;
    for (const [pathnamePrefix, normalizedRootDir] of sourceRequestRoutingMap) {
      if (url.pathname.startsWith(pathnamePrefix)) {
        const relativeFilePathname = url.pathname.slice(pathnamePrefix.length);
        await handleSourceFileRequest(res, relativeFilePathname, normalizedRootDir, config);
        handled = true;
        break;
      }
    }

    if (handled) {
      return;
    }

    // Index page
    if (url.pathname === '/' || url.pathname === '/index.html') {
      sendIndexPage(res);
      return;
    }

    // 404 for everything else
    sendText(res, 404, 'Not Found');
  };

  /**
   * Handle bundle request
   */
  const handleBundleRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> => {
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
      const requestSourcePaths = url.searchParams.get('sourcePaths') || 'url-server';
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

      // Construct URLs for sourceMappingURL and sourceURL
      const bundleUrl = `http://localhost:${port}${url.pathname}${url.search}`;
      // Handle both .bundle and .bundle.js extensions
      const mapPathname = url.pathname.replace(/\.bundle(\.js)?$/, '.map');
      const mapUrl = `http://localhost:${port}${mapPathname}${url.search}`;

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
      const cachedBuild = cachedBuilds.get(requestPlatform);
      if (cachedBuild) {
        let bundleWithRefs = cachedBuild.code;
        // Metro-compatible: sourceMappingURL comes before sourceURL
        if (cachedBuild.map) {
          bundleWithRefs += `\n//# sourceMappingURL=${mapUrl}`;
        }
        bundleWithRefs += `\n//# sourceURL=${bundleUrl}`;

        if (supportsMultipart) {
          createMultipartResponse(bundleWithRefs, cachedBuild.graph?.size || 0);
        } else {
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-cache',
            'X-React-Native-Project-Root': config.root,
          });
          res.end(bundleWithRefs);
        }
        return;
      }

      // If already building for this platform, wait for it
      const existingBuildPromise = buildingPlatforms.get(requestPlatform);
      if (existingBuildPromise) {
        const build = await existingBuildPromise;
        cachedBuilds.set(requestPlatform, build);

        let bundleWithRefs = build.code;
        // Metro-compatible: sourceMappingURL comes before sourceURL
        if (build.map) {
          bundleWithRefs += `\n//# sourceMappingURL=${mapUrl}`;
        }
        bundleWithRefs += `\n//# sourceURL=${bundleUrl}`;

        if (supportsMultipart) {
          createMultipartResponse(bundleWithRefs, build.graph?.size || 0);
        } else {
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-cache',
            'X-React-Native-Project-Root': config.root,
          });
          res.end(bundleWithRefs);
        }
        return;
      }

      // Start new build
      console.log(`Building ${requestPlatform} bundle...`);

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
          const buildPromise = buildWithGraph(
            platformConfig,
            (transformedFileCount, totalFileCount) => {
              totalCount = totalFileCount;
              const currentProgress = Math.floor((transformedFileCount / totalFileCount) * 100);
              if (currentProgress <= lastProgress && totalFileCount >= 10) {
                return;
              }
              lastProgress = currentProgress;

              const chunk =
                `${CRLF}--${BOUNDARY}${CRLF}` +
                `Content-Type: application/json${CRLF}${CRLF}` +
                JSON.stringify({ done: transformedFileCount, total: totalFileCount });
              res.write(chunk);
            },
            {
              excludeSource: requestExcludeSource,
              modulesOnly: requestModulesOnly,
              runModule: requestRunModule,
              bundleName,
              sourcePaths: requestSourcePaths === 'url-server' ? 'url-server' : 'absolute',
            },
          );

          buildingPlatforms.set(requestPlatform, buildPromise);
          const build = await buildPromise;
          buildingPlatforms.delete(requestPlatform);
          cachedBuilds.set(requestPlatform, build);

          if (build.graph) {
            totalCount = build.graph.size;
          }

          // Save build state for HMR
          saveBuildStateForHMR(requestPlatform, build);

          let bundleWithRefs = build.code;
          bundleWithRefs += `\n//# sourceURL=${bundleUrl}`;
          if (build.map) {
            bundleWithRefs += `\n//# sourceMappingURL=${mapUrl}`;
          }

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
          buildingPlatforms.delete(requestPlatform);
          console.error('Build error:', error);
          res.end(`${CRLF}--${BOUNDARY}--${CRLF}`);
        }
      } else {
        // Standard response
        try {
          const buildPromise = buildWithGraph(platformConfig, undefined, {
            excludeSource: requestExcludeSource,
            modulesOnly: requestModulesOnly,
            runModule: requestRunModule,
            bundleName,
            sourcePaths: requestSourcePaths === 'url-server' ? 'url-server' : 'absolute',
          });
          buildingPlatforms.set(requestPlatform, buildPromise);
          const build = await buildPromise;
          buildingPlatforms.delete(requestPlatform);
          cachedBuilds.set(requestPlatform, build);

          saveBuildStateForHMR(requestPlatform, build);

          let bundleWithRefs = build.code;
          bundleWithRefs += `\n//# sourceURL=${bundleUrl}`;
          if (build.map) {
            bundleWithRefs += `\n//# sourceMappingURL=${mapUrl}`;
          }

          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-cache',
            'X-React-Native-Project-Root': config.root,
          });
          res.end(bundleWithRefs);
        } catch (error) {
          buildingPlatforms.delete(requestPlatform);
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
  };

  /**
   * Save build state for HMR
   */
  const saveBuildStateForHMR = (requestPlatform: string, build: BuildResult) => {
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
  };

  /**
   * Handle open-url request
   */
  const handleOpenUrl = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const body = await readJsonBody<{ url?: string }>(req);
      const targetUrl = body?.url;
      if (targetUrl && typeof targetUrl === 'string') {
        let command: string;
        let args: string[];

        if (process.platform === 'win32') {
          command = 'cmd';
          args = ['/c', 'start', '', targetUrl];
        } else if (process.platform === 'darwin') {
          command = 'open';
          args = [targetUrl];
        } else {
          command = 'xdg-open';
          args = [targetUrl];
        }

        const proc = spawn(command, args, {
          detached: true,
          stdio: 'ignore',
        });
        proc.unref();

        console.log(`Opening URL in browser: ${targetUrl}`);
        sendJson(res, 200, { success: true });
      } else {
        sendJson(res, 400, { error: 'Invalid URL' });
      }
    } catch (error) {
      console.error('Error opening URL:', error);
      sendJson(res, 500, { error: 'Failed to open URL' });
    }
  };

  /**
   * Handle symbolicate request
   */
  const handleSymbolicate = async (
    req: IncomingMessage,
    res: ServerResponse,
    _url: URL,
  ): Promise<void> => {
    try {
      const body = await readJsonBody<{
        stack?: Array<{
          file?: string;
          lineNumber?: number;
          column?: number;
          methodName?: string;
        }>;
        extraData?: any;
      }>(req);

      const stack = body.stack || [];

      // Extract platform from stack frames
      const bundleUrlFromStack = stack.find((frame) => frame.file?.includes('.bundle'))?.file;
      let mapPlatform = platform;
      if (bundleUrlFromStack) {
        try {
          const urlObj = new URL(bundleUrlFromStack);
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
        sendJson(res, 200, {
          stack: stack.map((frame) => ({ ...frame })),
          codeFrame: null,
        });
        return;
      }

      // Reuse cached Consumer
      let consumer = sourceMapConsumers.get(mapPlatform);
      if (!consumer) {
        const metroSourceMap = await import('metro-source-map');
        const { Consumer } = metroSourceMap;
        const sourceMap = JSON.parse(cachedBuild.map);
        consumer = new Consumer(sourceMap);
        sourceMapConsumers.set(mapPlatform, consumer);
      }

      // Symbolicate each frame
      const symbolicatedStack = stack.map((frame) => {
        if (!frame.file || frame.lineNumber == null) {
          return { ...frame };
        }

        try {
          const originalPos = consumer.originalPositionFor({
            line: frame.lineNumber as any,
            column: (frame.column ?? 0) as any,
          });

          if (originalPos.source == null || originalPos.line == null) {
            return { ...frame };
          }

          const sourcePath = originalPos.source.startsWith('/')
            ? originalPos.source
            : resolve(config.root, originalPos.source);

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
          return { ...frame };
        }
      });

      // Generate code frame
      let codeFrame: {
        content: string;
        location: { row: number; column: number };
        fileName: string;
      } | null = null;

      for (const frame of symbolicatedStack) {
        if (frame.file && frame.lineNumber != null && !frame.file.includes('.bundle')) {
          try {
            const sourceCode = readFileSync(frame.file, 'utf-8');
            const lines = sourceCode.split('\n');
            const targetLine = (frame.lineNumber ?? 1) - 1;
            if (targetLine >= 0 && targetLine < lines.length) {
              const column = frame.column ?? 0;
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
            // Failed to read file
          }
        }
      }

      sendJson(res, 200, { stack: symbolicatedStack, codeFrame });
    } catch (error) {
      console.error('Symbolication failed:', error);
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  /**
   * Handle source file request (Metro-compatible)
   * Processes requests for source files from source maps like [metro-project]/App.tsx
   */
  const handleSourceFileRequest = async (
    res: ServerResponse,
    relativeFilePathname: string,
    rootDir: string,
    config: ResolvedConfig,
  ): Promise<void> => {
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
          normalizedFilePath = resolve(tryPath);
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

    try {
      const content = await Bun.file(normalizedFilePath).text();
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });
      res.end(content);
    } catch (error) {
      console.error(`Error reading source file ${normalizedFilePath}:`, error);
      sendText(res, 500, 'Internal Server Error');
    }
  };

  /**
   * Handle source map request (Metro-compatible)
   * Generates source map on demand if not cached, matching bundle request parameters
   */
  const handleSourceMapRequest = async (res: ServerResponse, url: URL): Promise<void> => {
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
      const mapSourcePaths = url.searchParams.get('sourcePaths') || 'url-server';

      // Extract bundle name from pathname
      const bundleNameMatch = url.pathname.match(/\/([^/]+\.bundle)(?:\.js)?$/);
      const bundleName = bundleNameMatch ? bundleNameMatch[1] : undefined;

      // Check if we have a cached build with matching parameters
      // For now, we use platform as cache key (can be extended to include other params)
      const cachedBuild = cachedBuilds.get(mapPlatform);

      // If cached build exists and parameters match, use it
      if (cachedBuild?.map) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
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
        sourcePaths: mapSourcePaths === 'url-server' ? 'url-server' : 'absolute',
      });

      if (build.map) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(build.map);
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end('{}');
      }
    } catch (error) {
      console.error('Source map generation failed:', error);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('{}');
    }
  };

  /**
   * Handle asset request
   */
  const handleAssetRequest = (res: ServerResponse, url: URL): void => {
    try {
      let assetRelativePath: string;
      if (url.pathname.startsWith('/assets/')) {
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

      // Remove scale suffix
      assetRelativePath = assetRelativePath.replace(/@\d+x\./, '.');
      assetRelativePath = assetRelativePath.replace(/\\/g, '/');
      const normalizedPath = assetRelativePath.replace(/\//g, sep);

      let resolvedAssetPath = resolve(config.root, normalizedPath);

      if (!existsSync(resolvedAssetPath)) {
        for (const nodeModulesPath of config.resolver.nodeModulesPaths) {
          const monorepoPath = resolve(config.root, nodeModulesPath);
          const alternativePath = resolve(monorepoPath, '..', normalizedPath);
          if (existsSync(alternativePath)) {
            resolvedAssetPath = alternativePath;
            break;
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
  };

  /**
   * Send index page
   */
  const sendIndexPage = (res: ServerResponse): void => {
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
    h1 { font-size: 28px; margin-bottom: 8px; font-weight: 600; color: #222; }
    h2 { font-size: 18px; margin: 30px 0 15px 0; font-weight: 600; color: #444; padding-bottom: 8px; border-bottom: 2px solid #e0e0e0; }
    p { margin: 8px 0; color: #666; }
    a { color: #007aff; text-decoration: none; }
    a:hover { color: #0051d5; text-decoration: underline; }
    ul { list-style: none; padding: 0; margin: 15px 0; }
    li { margin: 10px 0; padding: 8px 0; }
    code { background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 13px; color: #333; border: 1px solid #e0e0e0; }
    a code { background: #e8f4fd; border-color: #007aff; color: #007aff; }
    a:hover code { background: #d0e9fc; }
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
    <li><code>ws://localhost:${port}/hot</code></li>
  </ul>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };

  // Create HTTP server
  const httpServer = createHttpServer(handleRequest);

  // Handle WebSocket upgrades
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = parseRequestUrl(req, hostname, port);
    console.log(`[WS] Upgrade: ${url.pathname}`);

    // HMR WebSocket (/hot)
    if (url.pathname === '/hot' || url.pathname.startsWith('/hot?')) {
      hmrWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        hmrWss.emit('connection', ws, req);
      });
      return;
    }

    // CLI server API WebSocket endpoints (/message, /events, etc.)
    for (const [path, handler] of Object.entries(cliWebsocketEndpoints)) {
      if (url.pathname === path || url.pathname.startsWith(path + '?')) {
        (handler as any).handleUpgrade(req, socket, head, (ws: any) => {
          (handler as any).emit('connection', ws, req);
        });
        return;
      }
    }

    // Dev-middleware WebSocket endpoints (/inspector/*)
    if (devMiddleware) {
      for (const [path, handler] of Object.entries(devMiddleware.websocketEndpoints)) {
        if (url.pathname === path || url.pathname.startsWith(path + '/')) {
          console.log(`[WS] Inspector connected: ${url.pathname}`);
          handler.handleUpgrade(req, socket, head, (ws) => {
            handler.emit('connection', ws, req);
          });
          return;
        }
      }
    }

    // Unknown WebSocket endpoint
    socket.destroy();
  });

  // Start listening
  await new Promise<void>((resolve) => {
    httpServer.listen(port, hostname, () => {
      resolve();
    });
  });

  console.log(`\n✅ Dev server running at http://${hostname}:${port}`);
  console.log(`   HMR endpoint: ws://${hostname}:${port}/hot`);

  // Setup terminal keyboard shortcuts
  const useGlobalHotkey = server?.useGlobalHotkey ?? true;
  let terminalActionsCleanup: (() => void) | null = null;
  if (useGlobalHotkey && config.dev) {
    terminalActionsCleanup = setupTerminalActions({
      enabled: true,
      hmrClients,
      onClearCache: () => {
        for (const platformKey of cachedBuilds.keys()) {
          cachedBuilds.delete(platformKey);
        }
        sourceMapConsumers.clear();
        platformBuildStates.clear();
        buildingPlatforms.clear();
      },
      projectRoot: config.root,
      port,
      broadcast: (method: string, params?: unknown) =>
        broadcast(method, params as Record<string, any>),
    });
    console.log('\n📱 Terminal shortcuts enabled:');
    console.log('   r - Reload app');
    console.log('   d - Open Dev Menu');
    console.log('   j - Open DevTools');
    console.log('   i - Open iOS Simulator');
    console.log('   a - Open Android Emulator');
    console.log('   c - Clear cache');
  }

  // File watcher for HMR
  let fileWatcher: FileWatcher | null = null;
  if (config.dev) {
    const handleFileChange = async (changedFiles: string[] = []) => {
      console.log('File changed, invalidating cache and triggering HMR update...');

      for (const platformKey of cachedBuilds.keys()) {
        cachedBuilds.delete(platformKey);
        sourceMapConsumers.delete(platformKey);
        console.log(`Invalidated cache for ${platformKey}`);
      }

      if (platformBuildStates.size === 0) {
        console.log('No build states available yet. Waiting for initial build...');
        return;
      }

      if (hmrClients.size === 0) {
        console.log('No HMR clients connected. Cache invalidated, will rebuild on next request.');
        return;
      }

      const changedFilesSet = new Set(changedFiles);

      console.log(
        `Processing HMR update for ${platformBuildStates.size} platform(s), ${hmrClients.size} client(s) connected`,
      );

      for (const [platformKey, oldState] of platformBuildStates.entries()) {
        try {
          const platformConfig: ResolvedConfig = {
            ...config,
            platform: platformKey as 'ios' | 'android' | 'web',
          };

          const result = await incrementalBuild(
            Array.from(changedFilesSet),
            oldState,
            platformConfig,
          );

          if (!result) {
            console.warn(
              `Incremental build failed for ${platformKey}, falling back to full rebuild`,
            );
            cachedBuilds.delete(platformKey);
            sourceMapConsumers.delete(platformKey);
            buildingPlatforms.delete(platformKey);
            continue;
          }

          const { delta, newState } = result;

          if (delta.added.size === 0 && delta.modified.size === 0 && delta.deleted.size === 0) {
            console.log(`No changes detected for ${platformKey}`);
            continue;
          }

          platformBuildStates.set(platformKey, newState);

          const hmrMessage = await createHMRUpdateMessage(
            delta,
            platformConfig,
            newState.createModuleId,
            newState.revisionId,
            false,
            oldState.pathToModuleId,
            newState.graph,
          );

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

          // Validate message structure
          if (!hmrMessage.body) {
            console.error('CRITICAL: hmrMessage.body is missing!');
            continue;
          }
          if (!Array.isArray(hmrMessage.body.added)) hmrMessage.body.added = [];
          if (!Array.isArray(hmrMessage.body.modified)) hmrMessage.body.modified = [];
          if (!Array.isArray(hmrMessage.body.deleted)) hmrMessage.body.deleted = [];

          sendToClients({ type: 'update-start', body: { isInitialUpdate: false } }, 'update-start');
          sendToClients(hmrMessage, 'update');
          sendToClients({ type: 'update-done' }, 'update-done');

          console.log(
            `HMR update sent for ${platformKey}: ${delta.added.size} added, ` +
              `${delta.modified.size} modified, ${delta.deleted.size} deleted`,
          );

          cachedBuilds.delete(platformKey);
          sourceMapConsumers.delete(platformKey);
        } catch (error) {
          console.error(`Error processing HMR update for ${platformKey}:`, error);

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

          cachedBuilds.delete(platformKey);
          sourceMapConsumers.delete(platformKey);
          buildingPlatforms.delete(platformKey);
        }
      }
    };

    fileWatcher = createFileWatcher({
      root: config.root,
      onFileChange: handleFileChange,
      debounceMs: 300,
    });
  }

  // Graceful shutdown handlers
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    const isTestMode = process.env.NODE_ENV === 'test' || (globalThis as any).__BUNGAE_TEST_MODE__;
    if (!isTestMode) {
      console.log(`\n${signal} received, shutting down dev server...`);
    }

    try {
      if (terminalActionsCleanup) {
        terminalActionsCleanup();
        terminalActionsCleanup = null;
      }

      if (fileWatcher) {
        fileWatcher.close();
      }

      // Close WebSocket servers
      hmrWss.close();
      hmrClients.clear();
      // CLI server API WebSocket endpoints are closed automatically with httpServer

      // Close HTTP server
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (!isTestMode) {
        console.log('Server stopped');
        process.exit(0);
      }
    } catch (error) {
      if (!isTestMode) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
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

  return {
    stop: async () => {
      if (terminalActionsCleanup) {
        terminalActionsCleanup();
        terminalActionsCleanup = null;
      }

      if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
      }

      hmrWss.close();
      hmrClients.clear();

      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}

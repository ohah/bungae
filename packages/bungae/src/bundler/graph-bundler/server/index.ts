/**
 * Development server for Graph Bundler
 * Uses Node.js http.createServer() for full @react-native/dev-middleware compatibility
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http';
import { resolve } from 'path';
import type { Duplex } from 'stream';

// Import React Native CLI server API for message socket (reload/devMenu)
import { createDevServerMiddleware } from '@react-native-community/cli-server-api';
// Import WebSocket server from ws module (used by dev-middleware)
import { WebSocketServer, type WebSocket } from 'ws';

import type { ResolvedConfig } from '../../../config/types';
import { VERSION } from '../../../index';
import { createFileWatcher, type FileWatcher } from '../../file-watcher';
import { createHMRUpdateMessage, incrementalBuild } from '../hmr';
import { setupTerminalActions } from '../terminal-actions';
import type { BuildResult, HMRErrorMessage, PlatformBuildState } from '../types';
import { printBanner } from '../utils';
import { loadDevMiddleware, type DevMiddleware } from './dev-middleware';
import { handleAssetRequest } from './handlers/asset-handler';
import { handleBundleRequest } from './handlers/bundle-handler';
import { sendIndexPage } from './handlers/index-handler';
import { handleOpenUrl } from './handlers/open-url-handler';
import { handleSourceFileRequest, handleSourceMapRequest } from './handlers/source-handler';
import { handleSymbolicate } from './handlers/symbolicate-handler';
import { parseRequestUrl, sendText } from './utils';

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
  const devMiddleware: DevMiddleware | null = await loadDevMiddleware(port, config.root);

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
      await handleBundleRequest(
        req,
        res,
        url,
        config,
        platform,
        port,
        cachedBuilds,
        buildingPlatforms,
        saveBuildStateForHMR,
      );
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
    if (url.pathname === '/symbolicate') {
      if (req.method !== 'POST') {
        // Metro-compatible: Return 405 for non-POST requests
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }
      await handleSymbolicate(req, res, url, config, platform, cachedBuilds, sourceMapConsumers);
      return;
    }

    // Source map request
    if (url.pathname.endsWith('.map')) {
      await handleSourceMapRequest(res, url, config, platform, cachedBuilds);
      return;
    }

    // Asset request
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/node_modules/')) {
      handleAssetRequest(res, url, config);
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
      sendIndexPage(res, port);
      return;
    }

    // 404 for everything else
    sendText(res, 404, 'Not Found');
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
      broadcast: (method: string, params?: Record<string, any>) => broadcast(method, params ?? {}),
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

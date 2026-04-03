/**
 * Development server for ZTS Bundler
 *
 * Uses zts one-shot build for initial bundle, then file-watcher for rebuilds.
 * Bungae handles HTTP serving, RN dev middleware, Metro HMR protocol,
 * and terminal shortcuts.
 */

import { readFileSync, existsSync } from 'fs';
import { mkdtempSync } from 'fs';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Duplex } from 'stream';

import { createDevServerMiddleware } from '@react-native-community/cli-server-api';
import { WebSocketServer, type WebSocket } from 'ws';

import type { ResolvedConfig } from '../../../config/types';
import { VERSION } from '../../../index';
import { createFileWatcher, type FileWatcher } from '../../file-watcher';
import { loadDevMiddleware, type DevMiddleware } from '../../graph-bundler/server/dev-middleware';
import { handleAssetRequest } from '../../graph-bundler/server/handlers/asset-handler';
import { sendIndexPage } from '../../graph-bundler/server/handlers/index-handler';
import { handleOpenUrl } from '../../graph-bundler/server/handlers/open-url-handler';
import { parseRequestUrl, sendText } from '../../graph-bundler/server/utils';
import { setupTerminalActions } from '../../graph-bundler/terminal-actions';
import { printBanner } from '../../graph-bundler/utils';
import { runZtsBuild } from '../process';

/**
 * Start dev server with zts bundler backend
 */
export async function serveWithZts(config: ResolvedConfig): Promise<{ stop: () => Promise<void> }> {
  const { server } = config;
  const port = server?.port ?? 8081;
  const hostname = server?.host || '0.0.0.0';

  printBanner(VERSION);
  console.log('📦 Using zts-bundler (Zig, fast)');
  console.log(`Starting dev server on http://${hostname}:${port}`);

  // Temp directory for zts output
  const outputDir = mkdtempSync(join(tmpdir(), 'bungae-zts-'));
  const outputPath = join(outputDir, 'bundle.js');
  const sourceMapPath = `${outputPath}.map`;

  // Track current bundle state
  let currentBundle: string | null = null;
  let currentSourceMap: string | null = null;
  let lastBuildError: string | null = null;
  let isBuilding = false;

  // Build function
  const doBuild = async () => {
    if (isBuilding) return;
    isBuilding = true;
    const startTime = Date.now();
    console.log('[zts] Building...');

    try {
      const result = await runZtsBuild(config, outputPath);
      // Check output file even if result reports failure (signal kill etc.)
      if (existsSync(outputPath)) {
        lastBuildError = null;
        currentBundle = readFileSync(outputPath, 'utf-8');
        if (existsSync(sourceMapPath)) {
          currentSourceMap = readFileSync(sourceMapPath, 'utf-8');
        }
        const elapsed = Date.now() - startTime;
        const size = (Buffer.byteLength(currentBundle) / 1024).toFixed(1);
        console.log(`[zts] Build success: ${size}KB in ${elapsed}ms`);
      } else if (!result.success) {
        lastBuildError = result.error ?? 'Unknown build error';
        console.error(`[zts] Build failed: ${lastBuildError}`);
      }
    } catch (err) {
      lastBuildError = err instanceof Error ? err.message : String(err);
      console.error(`[zts] Build error: ${lastBuildError}`);
    } finally {
      isBuilding = false;
    }
  };

  // Load RN dev middleware
  const devMiddleware: DevMiddleware | null = await loadDevMiddleware(port, config.root);
  if (devMiddleware) {
    console.log('   DevTools endpoints:', Object.keys(devMiddleware.websocketEndpoints).join(', '));
  }

  const devMiddlewarePathPrefixes = [
    '/json',
    '/open-debugger',
    '/debugger-frontend',
    '/launch-js-devtools',
  ];

  // Create RN CLI server middleware
  const { websocketEndpoints: cliWebsocketEndpoints, messageSocketEndpoint } =
    createDevServerMiddleware({ port, host: hostname, watchFolders: [config.root] });
  const broadcast = messageSocketEndpoint.broadcast;
  console.log('   CLI endpoints:', Object.keys(cliWebsocketEndpoints).join(', '));

  // HMR clients
  const hmrClients = new Set<{ send: (msg: string) => void }>();
  const hmrWss = new WebSocketServer({ noServer: true });

  hmrWss.on('connection', (ws: WebSocket) => {
    console.log('[HMR] Client connected');
    const client = {
      send: (msg: string) => {
        try {
          ws.send(msg);
        } catch {
          /* disconnected */
        }
      },
    };
    hmrClients.add(client);

    ws.on('message', (message: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(message.toString());
        if (msg.type === 'register-entrypoints') {
          ws.send(JSON.stringify({ type: 'bundle-registered' }));
        }
      } catch {
        /* ignore */
      }
    });

    ws.on('close', () => {
      console.log('[HMR] Client disconnected');
      hmrClients.delete(client);
    });
  });

  // Initial build
  await doBuild();

  // HTTP request handler
  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = parseRequestUrl(req, hostname, port);

    // Dev middleware
    if (devMiddleware) {
      const shouldHandle = devMiddlewarePathPrefixes.some(
        (prefix) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'),
      );
      if (shouldHandle) {
        return new Promise<void>((resolveMiddleware) => {
          devMiddleware.middleware(req, res, () => resolveMiddleware());
        }).then(() => {
          if (!res.headersSent) handleRoutes(req, res, url);
        });
      }
    }

    await handleRoutes(req, res, url);
  };

  const handleRoutes = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> => {
    // Bundle request
    if (url.pathname.endsWith('.bundle') || url.pathname.endsWith('.bundle.js')) {
      if (lastBuildError) {
        const errorJs = `throw new Error(${JSON.stringify(lastBuildError)});`;
        sendText(res, 200, errorJs, 'application/javascript');
        return;
      }

      if (!currentBundle) {
        // If build is in progress, wait for it
        if (isBuilding) {
          console.log('[zts] Bundle requested while building, waiting...');
          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              if (!isBuilding) {
                clearInterval(check);
                resolve();
              }
            }, 100);
            // Timeout after 120s
            setTimeout(() => {
              clearInterval(check);
              resolve();
            }, 120000);
          });
        }
        // Check again after waiting
        if (lastBuildError) {
          const errorJs = `throw new Error(${JSON.stringify(lastBuildError)});`;
          sendText(res, 200, errorJs, 'application/javascript');
          return;
        }
        if (!currentBundle) {
          sendText(res, 503, 'Bundle not ready yet. Build may have failed - check server logs.');
          return;
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Content-Length': Buffer.byteLength(currentBundle),
      });
      res.end(currentBundle);
      return;
    }

    // Source map
    if (url.pathname.endsWith('.map') || url.pathname.endsWith('.bundle.map')) {
      if (!currentSourceMap) {
        sendText(res, 404, 'Source map not available');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(currentSourceMap),
      });
      res.end(currentSourceMap);
      return;
    }

    // Status
    if (url.pathname === '/status' || url.pathname === '/status.txt') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'X-React-Native-Project-Root': config.root,
      });
      res.end('packager-status:running');
      return;
    }

    // Reload
    if (url.pathname === '/reload') {
      broadcast('reload');
      sendText(res, 200, 'OK');
      return;
    }

    // Dev menu
    if (url.pathname === '/devmenu') {
      broadcast('devMenu');
      sendText(res, 200, 'OK');
      return;
    }

    // Open URL
    if (url.pathname === '/open-url' && req.method === 'POST') {
      await handleOpenUrl(req, res);
      return;
    }

    // Assets
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/node_modules/')) {
      handleAssetRequest(res, url, config);
      return;
    }

    // Index page
    if (url.pathname === '/' || url.pathname === '/index.html') {
      sendIndexPage(res, port);
      return;
    }

    sendText(res, 404, 'Not Found');
  };

  // Create HTTP server
  const httpServer = createHttpServer(handleRequest);

  // WebSocket upgrades
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = parseRequestUrl(req, hostname, port);

    if (url.pathname === '/hot' || url.pathname.startsWith('/hot?')) {
      hmrWss.handleUpgrade(req, socket, head, (ws) => hmrWss.emit('connection', ws, req));
      return;
    }

    for (const [path, handler] of Object.entries(cliWebsocketEndpoints)) {
      if (url.pathname === path || url.pathname.startsWith(path + '?')) {
        (handler as any).handleUpgrade(req, socket, head, (ws: any) => {
          (handler as any).emit('connection', ws, req);
        });
        return;
      }
    }

    if (devMiddleware) {
      for (const [path, handler] of Object.entries(devMiddleware.websocketEndpoints)) {
        if (url.pathname === path || url.pathname.startsWith(path + '/')) {
          handler.handleUpgrade(req, socket, head, (ws) => handler.emit('connection', ws, req));
          return;
        }
      }
    }

    socket.destroy();
  });

  // Start listening
  await new Promise<void>((resolve) => {
    httpServer.listen(port, hostname, () => resolve());
  });

  console.log(`\n✅ Dev server running at http://${hostname}:${port}`);
  console.log(`   HMR endpoint: ws://${hostname}:${port}/hot`);
  console.log(`   Bundler: zts (Zig-based, one-shot build)`);

  // Terminal shortcuts
  const useGlobalHotkey = server?.useGlobalHotkey ?? true;
  let terminalActionsCleanup: (() => void) | null = null;
  if (useGlobalHotkey && config.dev) {
    terminalActionsCleanup = setupTerminalActions({
      enabled: true,
      hmrClients,
      onClearCache: () => {
        currentBundle = null;
        currentSourceMap = null;
        lastBuildError = null;
      },
      projectRoot: config.root,
      port,
      broadcast: (method: string, params?: Record<string, any>) => broadcast(method, params ?? {}),
    });
    console.log('\n📱 Terminal shortcuts enabled:');
    console.log('   r - Reload app    d - Dev Menu    j - DevTools');
    console.log('   i - iOS Sim       a - Android     c - Clear cache');
  }

  // File watcher for rebuilds
  let fileWatcher: FileWatcher | null = null;
  if (config.dev) {
    fileWatcher = createFileWatcher({
      root: config.root,
      onFileChange: async () => {
        await doBuild();
        // Notify HMR clients to reload
        if (hmrClients.size > 0 && !lastBuildError) {
          sendHmrReload(hmrClients);
        } else if (hmrClients.size > 0 && lastBuildError) {
          sendHmrError(hmrClients, lastBuildError);
        }
      },
      debounceMs: 300,
    });
  }

  // Shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n${signal} received, shutting down...`);

    try {
      fileWatcher?.close();
      terminalActionsCleanup?.();
      hmrWss.close();
      hmrClients.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      console.log('Server stopped');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return {
    stop: async () => {
      fileWatcher?.close();
      terminalActionsCleanup?.();
      hmrWss.close();
      hmrClients.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/**
 * Send HMR full-reload to all clients (Metro protocol)
 */
function sendHmrReload(clients: Set<{ send: (msg: string) => void }>): void {
  const revisionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const messages = [
    { type: 'update-start', body: { isInitialUpdate: false } },
    {
      type: 'update',
      body: { revisionId, isInitialUpdate: false, added: [], modified: [], deleted: [] },
    },
    { type: 'update-done' },
  ];
  for (const msg of messages) {
    const msgStr = JSON.stringify(msg);
    for (const client of clients) {
      try {
        client.send(msgStr);
      } catch {
        /* disconnected */
      }
    }
  }
}

/**
 * Send HMR error to all clients (Metro protocol)
 */
function sendHmrError(clients: Set<{ send: (msg: string) => void }>, error: string): void {
  const errorMessage = JSON.stringify({
    type: 'error',
    body: { type: 'BuildError', message: error },
  });
  for (const client of clients) {
    try {
      client.send(errorMessage);
    } catch {
      /* disconnected */
    }
  }
}

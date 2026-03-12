/**
 * OXC Dev Server
 *
 * Development server for oxc-bundler.
 * Uses buildWithOxc() for full rebuilds + file watcher for change detection.
 * On file change: rebuild → cache → send hmr:reload to connected clients.
 *
 * Reuses: terminal-actions, dev-middleware, server utils from graph-bundler.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import type { ResolvedConfig } from '../../../config/types';
import { loadDevMiddleware, type DevMiddleware } from '../../graph-bundler/server/dev-middleware';
import { parseRequestUrl, sendJson, sendText } from '../../graph-bundler/server/utils';
import { setupTerminalActions } from '../../graph-bundler/terminal-actions';
import { OxcDevEngine } from '../hmr';
import type { HMRClient, HMRClientMessage, HMRServerError } from '../hmr/types';

/**
 * Start the OXC dev server
 */
export async function serveWithOxc(config: ResolvedConfig): Promise<{ stop: () => Promise<void> }> {
  const host = '0.0.0.0';
  const port = config.server?.port || 8081;

  // Initialize DevEngine (buildWithOxc + file watcher)
  const devEngine = new OxcDevEngine(config, { host, port });

  // Track HMR clients
  const hmrClients = new Map<string, HMRClient>();
  let clientIdCounter = 0;

  // --- HTTP Server ---
  const httpServer = createServer();

  // Load DevTools middleware
  let devMiddleware: DevMiddleware | null = null;
  try {
    devMiddleware = await loadDevMiddleware(port, config.root);
  } catch {
    // DevTools middleware optional
  }

  // Load CLI server API for message socket
  let cliServerMiddleware: any = null;
  let messageSocket: any = null;
  try {
    const cliServerApi = await import('@react-native-community/cli-server-api');
    const result = cliServerApi.createDevServerMiddleware({
      host,
      port,
      watchFolders: [config.root],
    });
    cliServerMiddleware = result.middleware;
    messageSocket = result.messageSocketEndpoint;
  } catch {
    // CLI server API optional
  }

  // --- Request Handler ---
  httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    const url = parseRequestUrl(req, host, port);
    const pathname = url.pathname;

    // DevTools middleware (handles /json, /open-debugger, etc.)
    if (devMiddleware) {
      const handled = await tryMiddleware(devMiddleware.middleware, req, res);
      if (handled) return;
    }

    // CLI server middleware
    if (cliServerMiddleware) {
      const handled = await tryMiddleware(cliServerMiddleware, req, res);
      if (handled) return;
    }

    // Bundle request: *.bundle or *.bundle.js
    if (pathname.endsWith('.bundle') || pathname.endsWith('.bundle.js')) {
      await handleBundleRequest(res, devEngine, config);
      return;
    }

    // Source map request: *.map or *.bundle.map
    if (pathname.endsWith('.map')) {
      await handleSourceMapRequest(res, devEngine);
      return;
    }

    // Status endpoint — RN native code expects exact plain text "packager-status:running"
    // (RCTBundleURLProvider.mm does string comparison, not JSON parsing)
    if (pathname === '/status' || pathname === '/status.txt') {
      sendText(res, 200, 'packager-status:running');
      return;
    }

    // Reload endpoint
    if (pathname === '/reload') {
      if (messageSocket) {
        messageSocket.broadcast('reload');
      }
      sendText(res, 200, 'OK');
      return;
    }

    // Dev menu endpoint
    if (pathname === '/devmenu') {
      if (messageSocket) {
        messageSocket.broadcast('devMenu');
      }
      sendText(res, 200, 'OK');
      return;
    }

    // Index page
    if (pathname === '/') {
      sendText(
        res,
        200,
        '<html><body><h1>Bungae Dev Server (OXC)</h1><p>Running with Rolldown</p></body></html>',
        'text/html',
      );
      return;
    }

    // 404
    sendText(res, 404, 'Not Found');
  });

  // --- WebSocket Setup ---
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = parseRequestUrl(req, host, port);

    // HMR WebSocket endpoint
    if (url.pathname === '/hot') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleHMRConnection(ws, hmrClients, clientIdCounter++);
      });
      return;
    }

    // DevTools WebSocket endpoints
    if (devMiddleware?.websocketEndpoints) {
      for (const [path, endpoint] of Object.entries(devMiddleware.websocketEndpoints)) {
        if (url.pathname === path || url.pathname.startsWith(path + '/')) {
          endpoint.handleUpgrade(req, socket, head, (ws: WebSocket) => {
            endpoint.emit('connection', ws, req);
          });
          return;
        }
      }
    }

    // CLI server WebSocket endpoints (/message, /events)
    if (messageSocket && (url.pathname === '/message' || url.pathname === '/events')) {
      if (messageSocket.server) {
        messageSocket.server.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          messageSocket.server.emit('connection', ws, req);
        });
        return;
      }
    }

    socket.destroy();
  });

  // --- DevEngine Events ---

  // On successful rebuild: send reload to all HMR clients
  devEngine.on('buildDone', () => {
    for (const client of hmrClients.values()) {
      client.send(JSON.stringify({ type: 'hmr:reload' }));
    }
  });

  // On build failure: send error to all HMR clients
  devEngine.on('buildFailed', (error: Error) => {
    const errorPayload: HMRServerError = {
      type: 'BuildError',
      message: error.message,
      errors: [{ description: error.message }],
    };

    for (const client of hmrClients.values()) {
      client.send(JSON.stringify({ type: 'hmr:error', payload: errorPayload }));
    }
  });

  // --- Terminal Actions ---
  const hmrClientSet = new Set<{ send: (msg: string) => void }>();
  const cleanupTerminal = setupTerminalActions({
    enabled: config.server?.useGlobalHotkey !== false,
    hmrClients: hmrClientSet,
    onClearCache: () => {
      console.log('[OXC] Cache cleared');
    },
    projectRoot: config.root,
    port,
    broadcast: messageSocket
      ? (method: string, params?: Record<string, any>) => {
          messageSocket.broadcast(method, params);
        }
      : undefined,
  });

  // --- Start ---
  console.log('⚡ Starting Rolldown build...');
  await devEngine.start();

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      resolve();
    });
  });

  printServerInfo(host, port, config);

  return {
    stop: async () => {
      cleanupTerminal();
      await devEngine.close();
      wss.close();
      httpServer.close();
    },
  };
}

// --- Request Handlers ---

async function handleBundleRequest(
  res: ServerResponse,
  devEngine: OxcDevEngine,
  config: ResolvedConfig,
): Promise<void> {
  try {
    const bundle = await devEngine.getBundle();

    let code = bundle.code;
    const entryName = config.entry.replace(/\.(js|ts|tsx)$/, '');
    if (bundle.map) {
      code += `\n//# sourceMappingURL=${entryName}.map`;
    }

    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Content-Length': Buffer.byteLength(code),
    });
    res.end(code);
  } catch (error: any) {
    sendJson(res, 500, {
      type: 'InternalError',
      message: error.message,
      errors: [{ description: error.message }],
    });
  }
}

async function handleSourceMapRequest(res: ServerResponse, devEngine: OxcDevEngine): Promise<void> {
  try {
    const bundle = await devEngine.getBundle();

    if (bundle.map) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bundle.map),
      });
      res.end(bundle.map);
    } else {
      sendText(res, 404, 'No source map available');
    }
  } catch (error: any) {
    sendJson(res, 500, { error: error.message });
  }
}

// --- HMR Connection Handler ---

function handleHMRConnection(
  ws: WebSocket,
  clients: Map<string, HMRClient>,
  clientNum: number,
): void {
  const clientId = `client-${clientNum}`;
  console.log(`[HMR] Client connected: ${clientId}`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as HMRClientMessage;

      if (message.type === 'hmr:connected') {
        const client: HMRClient = {
          id: clientId,
          platform: message.platform,
          bundleEntry: message.bundleEntry,
          send: (msg) => {
            if (ws.readyState === ws.OPEN) ws.send(msg);
          },
        };
        clients.set(clientId, client);
        console.log(`[HMR] Client registered: ${clientId} (${message.platform})`);
      }
    } catch (error) {
      console.error('[HMR] Failed to process message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`[HMR] Client disconnected: ${clientId}`);
    clients.delete(clientId);
  });

  ws.on('error', (error) => {
    console.error(`[HMR] Client error (${clientId}):`, error);
  });
}

// --- Utilities ---

function tryMiddleware(
  middleware: (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => void,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  return new Promise((resolve) => {
    middleware(req, res, () => {
      resolve(false);
    });
    res.on('finish', () => resolve(true));
  });
}

function printServerInfo(host: string, port: number, config: ResolvedConfig): void {
  console.log(`\n⚡ Bungae OXC Dev Server`);
  console.log(`  http://${host}:${port}`);
  console.log(`  Platform: ${config.platform}`);
  console.log(`  Entry: ${config.entry}`);
  console.log(`  HMR: ws://${host}:${port}/hot (full reload)`);
  console.log(`  Bundler: Rolldown (buildWithOxc)`);
  console.log('');
  console.log('📱 Terminal shortcuts:');
  console.log('   r - Reload app');
  console.log('   d - Open Dev Menu');
  console.log('   j - Open DevTools');
  console.log('   i - Open iOS Simulator');
  console.log('   a - Open Android Emulator');
  console.log('   c - Clear cache');
  console.log('');
}

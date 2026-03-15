/**
 * OXC Dev Server
 *
 * Development server for oxc-bundler.
 * Uses buildWithOxc() for full rebuilds + file watcher for change detection.
 * On file change: rebuild → cache → send hmr:reload to connected clients.
 *
 * Reuses: terminal-actions, dev-middleware, server utils from graph-bundler.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, extname, join } from 'node:path';

import { WebSocketServer, type WebSocket } from 'ws';

import type { ResolvedConfig } from '../../../config/types';
import { loadDevMiddleware, type DevMiddleware } from '../../graph-bundler/server/dev-middleware';
import { parseRequestUrl, sendJson, sendText } from '../../graph-bundler/server/utils';
import { setupTerminalActions } from '../../graph-bundler/terminal-actions';
import { OxcDevEngine } from '../hmr';
import type { HMRClient, HMRClientMessage, HMRServerError, HMRUpdateResult } from '../hmr/types';

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

    // Bundle request: *.bundle or *.bundle.js
    // Handle BEFORE middlewares — CLI server middleware may intercept bundle requests
    if (pathname.endsWith('.bundle') || pathname.endsWith('.bundle.js')) {
      await handleBundleRequest(res, devEngine, config);
      return;
    }

    // Source map request: *.map or *.bundle.map
    if (pathname.endsWith('.map')) {
      await handleSourceMapRequest(res, devEngine);
      return;
    }

    // Symbolicate endpoint: resolve stack traces to original source locations
    if (pathname === '/symbolicate') {
      await handleSymbolicateRequest(req, res, devEngine);
      return;
    }

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

    // Asset request: /assets/... (Metro-compatible asset serving)
    if (pathname.startsWith('/assets/') || pathname.includes('/assets/')) {
      handleAssetRequest(req, res, config);
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
        handleHMRConnection(ws, hmrClients, clientIdCounter++, devEngine);
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

  // On HMR update from DevEngine: send patch or reload to clients
  devEngine.on('hmrUpdate', (result: HMRUpdateResult) => {
    for (const clientUpdate of result.updates) {
      const update = clientUpdate.update;

      // Find the target client, or broadcast to all
      const targetClient = hmrClients.get(clientUpdate.clientId);
      const targets = targetClient ? [targetClient] : Array.from(hmrClients.values());

      for (const client of targets) {
        switch (update.type) {
          case 'Patch':
            client.send(JSON.stringify({ type: 'hmr:update-start' }));
            client.send(JSON.stringify({ type: 'hmr:update', code: update.code }));
            client.send(JSON.stringify({ type: 'hmr:update-done' }));
            break;

          case 'FullReload':
            // Rebuild bundle so next request gets fresh code
            devEngine.rebuild().catch((err) => {
              console.error('[HMR] Rebuild failed:', err);
            });
            client.send(JSON.stringify({ type: 'hmr:reload' }));
            break;

          case 'Noop':
            // Nothing to do
            break;
        }
      }
    }
  });

  // On successful rebuild (initial or full): notify clients
  devEngine.on('buildDone', () => {
    // Initial build or full rebuild completed - clients already get
    // the bundle via HTTP request, no need to send reload here
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

    // Strip Rolldown's own //# sourceMappingURL comment (it points to a wrong filename).
    // We append the correct one below.
    let code = bundle.code.replace(/\n?\/\/#\s*sourceMappingURL=[^\n]*/g, '');

    const entryName = config.entry.replace(/\.(js|ts|tsx)$/, '');
    if (bundle.map) {
      code += `\n//# sourceMappingURL=${entryName}.map`;
    }

    // DEBUG: dump bundle + source map for analysis
    try {
      writeFileSync('/tmp/bungae-bundle-debug.js', code, 'utf-8');
      if (bundle.map) {
        writeFileSync('/tmp/bungae-sourcemap-debug.json', bundle.map, 'utf-8');
      }
    } catch {}

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

/**
 * Handle /symbolicate POST requests.
 * React Native sends stack traces here to resolve bundle line/column
 * positions back to original source file locations.
 *
 * Request body: { stack: [{ file, lineNumber, column, methodName }] }
 * Response: { stack: [{ file, lineNumber, column, methodName, collapse }] }
 */
let cachedTraceMap: any = null;
let cachedTraceMapSrc: string | undefined;

async function handleSymbolicateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  devEngine: OxcDevEngine,
): Promise<void> {
  try {
    // Read request body
    const body = await new Promise<string>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    const { stack } = JSON.parse(body) as {
      stack: Array<{
        file?: string;
        lineNumber?: number;
        column?: number;
        methodName?: string;
      }>;
    };

    if (!stack || !Array.isArray(stack)) {
      sendJson(res, 400, { error: 'Invalid stack trace format' });
      return;
    }

    // Get source map and create TraceMap (cached)
    const bundle = await devEngine.getBundle();
    if (!bundle.map) {
      sendJson(res, 200, { stack });
      return;
    }

    // Re-create TraceMap only when map changes
    if (cachedTraceMapSrc !== bundle.map) {
      const { TraceMap } = await import('@jridgewell/trace-mapping');
      cachedTraceMap = new TraceMap(bundle.map);
      cachedTraceMapSrc = bundle.map;
    }

    const { originalPositionFor } = await import('@jridgewell/trace-mapping');

    // Symbolicate each frame
    const symbolicatedStack = stack.map((frame) => {
      if (!frame.lineNumber || frame.lineNumber < 1) return frame;

      try {
        const pos = originalPositionFor(cachedTraceMap, {
          line: frame.lineNumber,
          column: frame.column ?? 0,
        });

        if (pos.source) {
          return {
            file: pos.source,
            lineNumber: pos.line,
            column: pos.column,
            methodName: pos.name || frame.methodName,
            collapse: pos.source.indexOf('node_modules') >= 0,
          };
        }
      } catch {
        // Fall through to return original frame
      }

      return frame;
    });

    sendJson(res, 200, { stack: symbolicatedStack });
  } catch (error: any) {
    sendJson(res, 500, { error: error.message });
  }
}

// --- HMR Connection Handler ---

function handleHMRConnection(
  ws: WebSocket,
  clients: Map<string, HMRClient>,
  clientNum: number,
  devEngine: OxcDevEngine,
): void {
  const clientId = `client-${clientNum}`;
  console.log(`[HMR] Client connected: ${clientId}`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as HMRClientMessage;

      switch (message.type) {
        case 'hmr:connected': {
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
          break;
        }

        case 'hmr:module-registered':
          devEngine.registerModules(clientId, message.modules).catch((err) => {
            console.error('[HMR] Failed to register modules:', err);
          });
          break;

        case 'hmr:invalidate':
          devEngine.invalidate(message.moduleId).catch((err) => {
            console.error('[HMR] Failed to invalidate module:', err);
          });
          break;
      }
    } catch (error) {
      console.error('[HMR] Failed to process message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`[HMR] Client disconnected: ${clientId}`);
    clients.delete(clientId);
    devEngine.removeClient(clientId).catch(() => {});
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

/** MIME types for common asset files */
const ASSET_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  json: 'application/json',
};

/**
 * Handle asset requests: /assets/{path}?platform=ios
 * Serves the best scale variant for the requested asset.
 * Metro-compatible: RN Image component requests assets via this endpoint.
 */
function handleAssetRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedConfig,
): void {
  const url = new URL(req.url || '/', `http://localhost`);
  const platform = (url.searchParams.get('platform') || config.platform) as string;

  // Extract asset path from URL
  // URL format: /assets/path/to/image.png or /path/to/assets/image.png
  let assetPath = decodeURIComponent(url.pathname);

  // Remove leading /assets/ prefix if present
  if (assetPath.startsWith('/assets/')) {
    assetPath = assetPath.slice('/assets/'.length);
  } else if (assetPath.startsWith('/')) {
    assetPath = assetPath.slice(1);
  }

  // Resolve to absolute path within project root
  const absolutePath = join(config.root, assetPath);
  const dir = dirname(absolutePath);
  const ext = extname(absolutePath).slice(1);
  const nameWithoutExt = basename(absolutePath, `.${ext}`);

  // Try to find the best asset file
  // 1. Try exact path first
  if (existsSync(absolutePath)) {
    serveAssetFile(absolutePath, ext, res);
    return;
  }

  // 2. Try platform-specific variant
  const platformPath = join(dir, `${nameWithoutExt}.${platform}.${ext}`);
  if (existsSync(platformPath)) {
    serveAssetFile(platformPath, ext, res);
    return;
  }

  // 3. Try with node_modules resolution (including monorepo parent dirs)
  const nodeModulesSearchPaths = [config.root, ...(config.resolver.nodeModulesPaths || [])];
  for (const searchPath of nodeModulesSearchPaths) {
    const nmPath = join(searchPath, assetPath);
    if (existsSync(nmPath)) {
      serveAssetFile(nmPath, ext, res);
      return;
    }
  }

  // 4. Try require.resolve for node_modules assets (handles .bun cache paths)
  if (assetPath.startsWith('node_modules/')) {
    const packagePath = assetPath.replace(/^node_modules\//, '');
    try {
      const resolved = require.resolve(packagePath, {
        paths: [config.root, ...(config.resolver.nodeModulesPaths || [])],
      });
      if (existsSync(resolved)) {
        serveAssetFile(resolved, ext, res);
        return;
      }
    } catch {
      // require.resolve can't find it — fall through to 404
    }
  }

  sendText(res, 404, `Asset not found: ${assetPath}`);
}

function serveAssetFile(filePath: string, ext: string, res: ServerResponse): void {
  try {
    const content = readFileSync(filePath);
    const mimeType = ASSET_MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': content.length,
      'Cache-Control': 'public, max-age=31536000',
    });
    res.end(content);
  } catch {
    sendText(res, 500, 'Failed to read asset file');
  }
}

function printServerInfo(host: string, port: number, config: ResolvedConfig): void {
  console.log(`\n⚡ Bungae OXC Dev Server`);
  console.log(`  http://${host}:${port}`);
  console.log(`  Platform: ${config.platform}`);
  console.log(`  Entry: ${config.entry}`);
  console.log(`  HMR: ws://${host}:${port}/hot (patch + Fast Refresh)`);
  console.log(`  Bundler: Rolldown DevEngine`);
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

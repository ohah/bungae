/**
 * Development server for ZTS Bundler
 *
 * Uses zts --watch-json --dev mode for incremental builds with HMR support.
 * Bungae handles HTTP serving, RN dev middleware, custom ZTS HMR protocol,
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
import { loadDevMiddleware, type DevMiddleware } from '../../graph-bundler/server/dev-middleware';
import { handleAssetRequest } from '../../graph-bundler/server/handlers/asset-handler';
import { sendIndexPage } from '../../graph-bundler/server/handlers/index-handler';
import { handleOpenUrl } from '../../graph-bundler/server/handlers/open-url-handler';
import { parseRequestUrl, readJsonBody, sendJson, sendText } from '../../graph-bundler/server/utils';
import { setupTerminalActions } from '../../graph-bundler/terminal-actions';
import { printBanner } from '../../graph-bundler/utils';
import { spawnZtsWatch, type ZtsProcess } from '../process';

/**
 * Start dev server with zts bundler backend
 */
export async function serveWithZts(config: ResolvedConfig): Promise<{ stop: () => Promise<void> }> {
  const { server } = config;
  const port = server?.port ?? 8081;
  const hostname = server?.host || '0.0.0.0';

  printBanner(VERSION);
  console.log('📦 Using zts-bundler (Zig, fast, HMR)');
  console.log(`Starting dev server on http://${hostname}:${port}`);

  // Temp directory for zts output
  const outputDir = mkdtempSync(join(tmpdir(), 'bungae-zts-'));
  const outputPath = join(outputDir, 'bundle.js');
  const sourceMapPath = `${outputPath}.map`;

  // Track current bundle state
  let currentBundle: string | null = null;
  let currentSourceMap: string | null = null;
  let lastBuildError: string | null = null;

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
    createDevServerMiddleware({ port, host: hostname, watchFolders: [] }); // HMR이 파일 변경 처리 — CLI 자체 watch 비활성화 (rollipop 동일)
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

  /**
   * Send message to all connected HMR clients
   */
  const sendToClients = (msg: object) => {
    if (hmrClients.size === 0) return;
    const msgStr = JSON.stringify(msg);
    for (const client of hmrClients) {
      try {
        client.send(msgStr);
      } catch {
        /* disconnected */
      }
    }
  };

  // Spawn ZTS in watch mode — handles file watching + incremental rebuilds
  const ztsProcess: ZtsProcess = spawnZtsWatch(config, outputPath);

  // Wait for initial build
  await new Promise<void>((resolve) => {
    const onReady = () => {
      ztsProcess.removeListener('ready', onReady);
      ztsProcess.removeListener('error', onError);
      // Read the initial bundle from output file
      if (existsSync(outputPath)) {
        // ZTS가 삽입한 sourceMappingURL 제거 (번들 전송 시 Metro 호환 URL로 재삽입)
        currentBundle = readFileSync(outputPath, 'utf-8').replace(/\/\/# sourceMappingURL=[^\n]*/g, '');
        if (existsSync(sourceMapPath)) {
          currentSourceMap = readFileSync(sourceMapPath, 'utf-8');
        }
        const size = (Buffer.byteLength(currentBundle) / 1024).toFixed(1);
        console.log(`[zts] Initial build: ${size}KB`);
      } else {
        lastBuildError = 'Initial build produced no output';
        console.error(`[zts] ${lastBuildError}`);
      }
      resolve();
    };
    const onError = (error: Error) => {
      ztsProcess.removeListener('ready', onReady);
      ztsProcess.removeListener('error', onError);
      lastBuildError = error.message;
      console.error(`[zts] Initial build error: ${lastBuildError}`);
      resolve();
    };
    ztsProcess.on('ready', onReady);
    ztsProcess.on('error', onError);
  });

  // Handle rebuild events from ZTS watch mode
  ztsProcess.on('rebuild', (event) => {
    if (!event.success) {
      lastBuildError = event.error ?? 'Unknown build error';
      console.error(`[zts] Build failed: ${lastBuildError}`);
      sendToClients({ type: 'hmr:error', message: lastBuildError });
      return;
    }

    // Build succeeded — update cached bundle
    lastBuildError = null;
    if (existsSync(outputPath)) {
      // ZTS가 삽입한 sourceMappingURL 제거 (번들 전송 시 Metro 호환 URL로 재삽입)
      currentBundle = readFileSync(outputPath, 'utf-8').replace(/\/\/# sourceMappingURL=[^\n]*/g, '');
      if (existsSync(sourceMapPath)) {
        currentSourceMap = readFileSync(sourceMapPath, 'utf-8');
      }
    }

    const changedCount = event.changed?.length ?? 0;
    const updatesCount = event.updates?.length ?? 0;

    if (event.graph_changed) {
      // Module graph changed (new imports added) — full reload required
      console.log(`[zts] Graph changed (${changedCount} files), sending full reload`);
      sendToClients({ type: 'hmr:reload' });
    } else if (event.updates && event.updates.length > 0) {
      // Incremental HMR update — send changed module codes
      console.log(`[zts] HMR update: ${updatesCount} module(s) changed`);
      sendToClients({ type: 'hmr:update-start' });
      sendToClients({ type: 'hmr:update', modules: event.updates });
      sendToClients({ type: 'hmr:update-done' });
    } else if (changedCount > 0) {
      // 파일은 변경됐지만 코드 diff 없음 (타입만 변경, 주석만 변경 등) — 무시
      console.log(`[zts] Rebuilt (${changedCount} files), no code change — skipping`);
    }
  });

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
        sendText(res, 503, 'Bundle not ready yet. Build may have failed - check server logs.');
        return;
      }

      // Metro 호환: sourceMappingURL + sourceURL 주석 삽입
      // currentBundle에는 ZTS의 sourceMappingURL이 이미 제거된 상태
      const host = req.headers.host || `localhost:${port}`;
      const bundleUrl = `http://${host}${url.pathname}${url.search}`;
      const mapPathname = url.pathname.replace(/\.bundle(\.js)?$/, '.map');
      const mapUrl = `http://${host}${mapPathname}${url.search}`;

      const bundle = currentBundle +
        `\n//# sourceMappingURL=${mapUrl}` +
        `\n//# sourceURL=${bundleUrl}`;

      const acceptHeader = req.headers.accept || '';
      if (acceptHeader === 'multipart/mixed') {
        // RN expects multipart/mixed with progress messages to hide "Loading from Metro" bar
        const BOUNDARY = '3beqjf3apnqeu3h5jqorms4i';
        const CRLF = '\r\n';

        res.writeHead(200, {
          'Content-Type': `multipart/mixed; boundary="${BOUNDARY}"`,
          'Cache-Control': 'no-cache',
          'X-React-Native-Project-Root': config.root,
        });

        res.write('If you are seeing this, your client does not support multipart response');

        // Progress: done (bundle is already built)
        res.write(
          `${CRLF}--${BOUNDARY}${CRLF}` +
            `Content-Type: application/json${CRLF}${CRLF}` +
            JSON.stringify({ done: 1, total: 1 }),
        );

        // Bundle chunk
        const bundleBytes = Buffer.byteLength(bundle);
        const revisionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
        res.end(
          `${CRLF}--${BOUNDARY}${CRLF}` +
            `X-Metro-Files-Changed-Count: 0${CRLF}` +
            `X-Metro-Delta-ID: ${revisionId}${CRLF}` +
            `Content-Type: application/javascript; charset=UTF-8${CRLF}` +
            `Content-Length: ${bundleBytes}${CRLF}` +
            `Last-Modified: ${new Date().toUTCString()}${CRLF}${CRLF}` +
            bundle +
            `${CRLF}--${BOUNDARY}--${CRLF}`,
        );
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Content-Length': Buffer.byteLength(bundle),
        });
        res.end(bundle);
      }
      return;
    }

    // Source map (Metro 호환: /index.map, /index.bundle.map 등)
    if (url.pathname.endsWith('.map') || url.pathname.endsWith('.bundle.map')) {
      if (!currentSourceMap) {
        sendText(res, 404, 'Source map not available');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(currentSourceMap),
        'Access-Control-Allow-Origin': 'devtools://devtools',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      res.end(currentSourceMap);
      return;
    }

    // Symbolicate (스택트레이스 심볼리케이션)
    if (url.pathname === '/symbolicate' && req.method === 'POST') {
      await handleSymbolicateRequest(req, res, config, currentSourceMap);
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
  console.log(`   Bundler: zts (Zig-based, dev mode + HMR)`);

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

  // Shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    const isTestMode = process.env.NODE_ENV === 'test' || (globalThis as any).__BUNGAE_TEST_MODE__;
    if (!isTestMode) {
      console.log(`\n${signal} received, shutting down...`);
    }

    try {
      ztsProcess.kill();
      terminalActionsCleanup?.();
      hmrWss.close();
      hmrClients.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      if (!isTestMode) {
        console.log('Server stopped');
        process.exit(0);
      }
    } catch (error) {
      console.error('Error during shutdown:', error);
      if (!isTestMode) {
        process.exit(1);
      }
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return {
    stop: async () => {
      ztsProcess.kill();
      terminalActionsCleanup?.();
      hmrWss.close();
      hmrClients.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/**
 * Symbolicate stack traces using source map (스택트레이스 심볼리케이션)
 */
async function handleSymbolicateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedConfig,
  sourceMap: string | null,
): Promise<void> {
  try {
    const body = await readJsonBody<{
      stack?: Array<{
        file?: string;
        lineNumber?: number;
        column?: number;
        methodName?: string;
      }>;
    }>(req);

    const stack = body.stack || [];

    if (!sourceMap) {
      sendJson(res, 200, { stack, codeFrame: null });
      return;
    }

    let parsedMap: any;
    try {
      parsedMap = JSON.parse(sourceMap);
    } catch {
      // 소스맵이 아직 쓰이는 중이거나 손상된 경우
      sendJson(res, 200, { stack, codeFrame: null });
      return;
    }

    const { SourceMapConsumer } = await import('source-map');
    const consumer = await new SourceMapConsumer(parsedMap);

    try {
      const symbolicatedStack = stack.map((frame) => {
        if (!frame.file || frame.lineNumber == null) return { ...frame };
        try {
          const pos = consumer.originalPositionFor({
            line: frame.lineNumber,
            column: frame.column ?? 0,
          });
          if (pos.source == null || pos.line == null) return { ...frame };

          const { resolve } = require('path');
          let sourcePath = pos.source;
          if (sourcePath.startsWith('/')) {
            // absolute path — keep as is
          } else {
            sourcePath = resolve(config.root, sourcePath);
          }

          return {
            ...frame,
            file: sourcePath,
            lineNumber: pos.line,
            column: pos.column ?? 0,
            methodName: pos.name ?? frame.methodName,
          };
        } catch {
          return { ...frame };
        }
      });

      // Code frame for first non-internal frame
      let codeFrame: { content: string; location: { row: number; column: number }; fileName: string } | null = null;
      for (const frame of symbolicatedStack) {
        if (frame.file && frame.lineNumber != null && !frame.file.includes('.bundle')) {
          try {
            const source = readFileSync(frame.file, 'utf-8');
            const lines = source.split('\n');
            const targetLine = (frame.lineNumber ?? 1) - 1;
            if (targetLine >= 0 && targetLine < lines.length) {
              const startLine = Math.max(0, targetLine - 2);
              const endLine = Math.min(lines.length - 1, targetLine + 2);
              codeFrame = {
                content: lines.slice(startLine, endLine + 1).join('\n'),
                location: { row: frame.lineNumber ?? 1, column: frame.column ?? 0 },
                fileName: frame.file,
              };
              break;
            }
          } catch { /* file read failed */ }
        }
      }

      sendJson(res, 200, { stack: symbolicatedStack, codeFrame });
    } finally {
      consumer.destroy();
    }
  } catch (error) {
    console.error('Symbolication failed:', error);
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

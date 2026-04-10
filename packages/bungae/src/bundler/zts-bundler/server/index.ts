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
import * as jscSafeUrl from 'jsc-safe-url';
import { WebSocketServer, type WebSocket } from 'ws';

import type { ResolvedConfig } from '../../../config/types';
import { VERSION } from '../../../index';
import { loadDevMiddleware, type DevMiddleware } from '../../graph-bundler/server/dev-middleware';
import { handleAssetRequest } from '../../graph-bundler/server/handlers/asset-handler';
import { sendIndexPage } from '../../graph-bundler/server/handlers/index-handler';
import { handleOpenUrl } from '../../graph-bundler/server/handlers/open-url-handler';
import {
  parseRequestUrl,
  readJsonBody,
  sendJson,
  sendText,
} from '../../graph-bundler/server/utils';
import { setupTerminalActions } from '../../graph-bundler/terminal-actions';
import { colors, logInfo, logError, printBanner } from '../../graph-bundler/utils';
import { watchWithNapi } from '../napi-build';
import type { WatchHandle } from '@zts/core';

/**
 * zts 소스맵 후처리: x_google_ignoreList 확장.
 *
 * zts가 생성한 기존 x_google_ignoreList(폴리필)를 보존하고,
 * node_modules 소스를 추가로 등록하여 DevTools가 프레임워크 프레임을 자동 스킵.
 */
function postProcessSourceMap(rawJson: string, projectRoot: string): string {
  try {
    const map = JSON.parse(rawJson);
    if (map.version !== 3 || !map.sources) return rawJson;

    // 기존 x_google_ignoreList 보존 (zts가 생성한 폴리필 인덱스)
    const existing = new Set<number>(
      Array.isArray(map.x_google_ignoreList) ? map.x_google_ignoreList : [],
    );

    // node_modules 소스 추가
    for (let i = 0; i < map.sources.length; i++) {
      if (typeof map.sources[i] === 'string' && map.sources[i].includes('/node_modules/')) {
        existing.add(i);
      }
    }

    if (existing.size > 0) {
      map.x_google_ignoreList = [...existing].sort((a, b) => a - b);
    }

    return JSON.stringify(map);
  } catch {
    return rawJson;
  }
}

/**
 * Start dev server with zts bundler backend
 */
export async function serveWithZts(config: ResolvedConfig): Promise<{ stop: () => Promise<void> }> {
  const { server } = config;
  const port = server?.port ?? 8081;
  const hostname = server?.host || '0.0.0.0';

  printBanner(VERSION);

  // Per-platform state management
  interface PlatformState {
    handle: WatchHandle;
    outputDir: string;
    outputPath: string;
    sourceMapPath: string;
    bundle: string | null;
    sourceMap: string | null;
    buildError: string | null;
    fileCount: number;
    lastRebuildTime: number;
  }

  const platforms = new Map<string, PlatformState>();
  const defaultPlatform = config.platform ?? 'ios';

  /**
   * Get or create platform state. Spawns a new ZTS process if needed.
   */
  function getOrCreatePlatform(platform: string): PlatformState {
    let state = platforms.get(platform);
    if (state) return state;

    const outputDir = mkdtempSync(join(tmpdir(), `bungae-zts-${platform}-`));
    const outputPath = join(outputDir, 'bundle.js');
    const sourceMapPath = `${outputPath}.map`;
    const platformConfig: ResolvedConfig = { ...config, platform: platform as any };
    const buildStart = Date.now();

    const { handle } = watchWithNapi(platformConfig, outputPath, {
      onReady(event) {
        if (event.files) state!.fileCount = event.files;
        if (existsSync(outputPath)) {
          state!.bundle = readFileSync(outputPath, 'utf-8').replace(
            /\/\/# sourceMappingURL=[^\n]*/g,
            '',
          );
          if (existsSync(sourceMapPath)) {
            state!.sourceMap = postProcessSourceMap(
              readFileSync(sourceMapPath, 'utf-8'),
              config.root,
            );
          }
          const sizeKB = (Buffer.byteLength(state!.bundle) / 1024).toFixed(1);
          const buildTime = Date.now() - buildStart;
          logInfo(
            `Build complete ${colors.dim}[${platform}]${colors.reset} ${colors.dim}(${sizeKB} KB, ${buildTime}ms)${colors.reset}`,
          );
        } else {
          state!.buildError = 'Build produced no output';
          logError(`${state!.buildError} [${platform}]`);
        }
      },
      onRebuild(event) {
        const duration = Date.now() - state!.lastRebuildTime;
        state!.lastRebuildTime = Date.now();

        if (!event.success) {
          state!.buildError = event.error ?? 'Unknown build error';
          logError(`Build failed [${platform}]: ${state!.buildError}`);
          sendToClients(formatHmrError(state!.buildError));
          return;
        }

        state!.buildError = null;
        if (existsSync(outputPath)) {
          state!.bundle = readFileSync(outputPath, 'utf-8').replace(
            /\/\/# sourceMappingURL=[^\n]*/g,
            '',
          );
          if (existsSync(sourceMapPath)) {
            state!.sourceMap = postProcessSourceMap(
              readFileSync(sourceMapPath, 'utf-8'),
              config.root,
            );
          }
        }

        const changedCount = event.changed?.length ?? 0;
        const updatesCount = event.updates?.length ?? 0;

        if (event.graphChanged) {
          logInfo(
            `Graph changed ${colors.dim}[${platform}] (${changedCount} files, ${duration}ms)${colors.reset}, full reload`,
          );
          sendToClients({ type: 'hmr:reload' });
        } else if (event.updates && event.updates.length > 0) {
          logInfo(
            `HMR update ${colors.dim}[${platform}] ${updatesCount} module(s) (${duration}ms)${colors.reset}`,
          );
          sendToClients({ type: 'hmr:update-start' });
          sendToClients({ type: 'hmr:update', modules: event.updates });
          sendToClients({ type: 'hmr:update-done' });
        } else if (changedCount > 0) {
          logInfo(
            `Rebuilt ${colors.dim}[${platform}] (${changedCount} files, ${duration}ms, no code change)${colors.reset}`,
          );
        }
      },
    });

    state = {
      handle,
      outputDir,
      outputPath,
      sourceMapPath,
      bundle: null,
      sourceMap: null,
      buildError: null,
      fileCount: 1,
      lastRebuildTime: Date.now(),
    };

    platforms.set(platform, state);
    return state;
  }

  // Spawn default platform eagerly
  const defaultState = getOrCreatePlatform(defaultPlatform);

  // Wait for initial build
  await new Promise<void>((resolve) => {
    const check = () => {
      if (defaultState.bundle !== null || defaultState.buildError !== null) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });

  // Load RN dev middleware
  const devMiddleware: DevMiddleware | null = await loadDevMiddleware(port, config.root);

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

  // HMR clients
  const hmrClients = new Set<{ send: (msg: string) => void }>();
  const hmrWss = new WebSocketServer({ noServer: true });

  hmrWss.on('connection', (ws: WebSocket) => {
    logInfo('HMR client connected');
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
        } else if (msg.type === 'log') {
          // Console forwarding: client → terminal (Metro-style)
          const level: string = msg.level || 'log';
          const data: unknown[] = Array.isArray(msg.data) ? msg.data : [msg.data];

          const levelColor =
            level === 'error'
              ? colors.red
              : level === 'warn'
                ? colors.yellow
                : level === 'debug'
                  ? colors.magenta
                  : level === 'info'
                    ? colors.cyan
                    : colors.white;

          const badge = `${levelColor}${colors.inverse}${colors.bold} ${level.toUpperCase()} ${colors.reset}`;

          const formatted = data
            .map((arg) => {
              if (typeof arg === 'object' && arg !== null) {
                try {
                  return JSON.stringify(arg, null, 2);
                } catch {
                  return String(arg);
                }
              }
              return String(arg);
            })
            .join(' ');

          console.log(`${badge} ${formatted}`);
        }
      } catch {
        /* ignore */
      }
    });

    ws.on('close', () => {
      logInfo('HMR client disconnected');
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

  // ZTS processes and rebuild events are managed per-platform in getOrCreatePlatform()

  // HTTP request handler
  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = parseRequestUrl(req, hostname, port);

    // Symbolicate — dev middleware보다 먼저 처리 (RN LogBox 스택트레이스)
    if (url.pathname === '/symbolicate' && req.method === 'POST') {
      const platform = url.searchParams.get('platform') || defaultPlatform;
      const state = platforms.get(platform) || defaultState;
      await handleSymbolicateRequest(req, res, config, state.sourceMap);
      return;
    }

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
      // Detect platform from URL query param (?platform=ios)
      const platform = url.searchParams.get('platform') || defaultPlatform;
      const state = getOrCreatePlatform(platform);

      // Wait for build if still in progress (new platform spawned on demand)
      if (state.bundle === null && state.buildError === null) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (state.bundle !== null || state.buildError !== null) resolve();
            else setTimeout(check, 50);
          };
          check();
        });
      }

      if (state.buildError) {
        const errorJs = `throw new Error(${JSON.stringify(state.buildError)});`;
        sendText(res, 200, errorJs, 'application/javascript');
        return;
      }

      if (!state.bundle) {
        sendText(res, 503, 'Bundle not ready yet. Build may have failed - check server logs.');
        return;
      }

      // Metro 호환: sourceMappingURL + sourceURL 주석 삽입
      const host = req.headers.host || `localhost:${port}`;
      // Metro-compatible: sourceURL uses jscSafeUrl.toJscSafeUrl() for Hermes source map matching
      const fullUrl = `http://${host}${url.pathname}${url.search}${url.hash || ''}`;
      const bundleUrl = jscSafeUrl.toJscSafeUrl(fullUrl);
      const mapPathname = url.pathname.replace(/\.bundle(\.js)?$/, '.map');
      const mapUrl = `http://${host}${mapPathname}${url.search}`;

      const bundle =
        state.bundle + `\n//# sourceMappingURL=${mapUrl}` + `\n//# sourceURL=${bundleUrl}`;

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
            JSON.stringify({ done: state.fileCount, total: state.fileCount }),
        );

        // Bundle chunk
        const bundleBytes = Buffer.byteLength(bundle);
        const revisionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
        // X-Metro-Files-Changed-Count > 0이어야 네이티브가 번들 로드 완료로 인식
        res.end(
          `${CRLF}--${BOUNDARY}${CRLF}` +
            `X-Metro-Files-Changed-Count: ${state.fileCount}${CRLF}` +
            `X-Metro-Delta-ID: ${revisionId}${CRLF}` +
            `Content-Type: application/javascript; charset=UTF-8${CRLF}` +
            `Content-Length: ${bundleBytes}${CRLF}` +
            `Last-Modified: ${new Date().toUTCString()}${CRLF}${CRLF}` +
            bundle +
            `${CRLF}--${BOUNDARY}--${CRLF}`,
        );
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=UTF-8',
          'Content-Length': Buffer.byteLength(bundle),
          'Cache-Control': 'no-cache',
          'X-React-Native-Project-Root': config.root,
          'Content-Location': bundleUrl,
        });
        res.end(bundle);
      }
      return;
    }

    // Source map (Metro 호환: /index.map, /index.bundle.map 등)
    if (url.pathname.endsWith('.map') || url.pathname.endsWith('.bundle.map')) {
      const platform = url.searchParams.get('platform') || defaultPlatform;
      const state = platforms.get(platform) || defaultState;

      if (!state.sourceMap) {
        sendText(res, 404, 'Source map not available');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(state.sourceMap),
        'Access-Control-Allow-Origin': 'devtools://devtools',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      res.end(state.sourceMap);
      return;
    }

    // Symbolicate (스택트레이스 심볼리케이션) — 이미 handleRequest에서 처리
    if (url.pathname === '/symbolicate' && req.method === 'POST') {
      const platform = url.searchParams.get('platform') || defaultPlatform;
      const state = platforms.get(platform) || defaultState;
      await handleSymbolicateRequest(req, res, config, state.sourceMap);
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

  logInfo(`Dev server running on ${colors.bold}http://localhost:${port}${colors.reset}`);
  logInfo(
    `Bundler: ${colors.bold}zts${colors.reset} ${colors.dim}(Zig-based, dev mode + HMR)${colors.reset}`,
  );

  // Terminal shortcuts
  const useGlobalHotkey = server?.useGlobalHotkey ?? true;
  let terminalActionsCleanup: (() => void) | null = null;
  if (useGlobalHotkey && config.dev) {
    terminalActionsCleanup = setupTerminalActions({
      enabled: true,
      hmrClients,
      onClearCache: () => {
        for (const state of platforms.values()) {
          state.bundle = null;
          state.sourceMap = null;
          state.buildError = null;
        }
      },
      projectRoot: config.root,
      port,
      broadcast: (method: string, params?: Record<string, any>) => broadcast(method, params ?? {}),
    });
    console.log('');
    logInfo('Keyboard shortcuts:');
    console.log(
      `     ${colors.bold}r${colors.reset} - Reload    ${colors.bold}d${colors.reset} - Dev Menu    ${colors.bold}j${colors.reset} - DevTools`,
    );
    console.log(
      `     ${colors.bold}i${colors.reset} - iOS Sim   ${colors.bold}a${colors.reset} - Android     ${colors.bold}c${colors.reset} - Clear cache`,
    );
    console.log('');
  }

  // Shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    const isTestMode = process.env.NODE_ENV === 'test' || (globalThis as any).__BUNGAE_TEST_MODE__;
    if (!isTestMode) {
      logInfo(`${signal} received, shutting down...`);
    }

    try {
      for (const state of platforms.values()) state.handle.stop();
      terminalActionsCleanup?.();
      hmrWss.close();
      hmrClients.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      if (!isTestMode) {
        logInfo('Server stopped');
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
      for (const state of platforms.values()) state.handle.stop();
      terminalActionsCleanup?.();
      hmrWss.close();
      hmrClients.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/**
 * Format build error into Metro-compatible HMR error message.
 * React Native's LogBox/RedScreen expects: { type: 'error', body: { type, message, errors } }
 */
function formatHmrError(errorMessage: string): object {
  // Try to extract file:line:column from ZTS error output
  // ZTS format: "/path/to/file.ts:10:5: error: ..."
  const locationMatch = errorMessage.match(/([^\s]+\.[jt]sx?):(\d+):(\d+)/);

  const errors: Array<{
    description: string;
    filename?: string;
    lineNumber?: number;
    column?: number;
  }> = [];

  if (locationMatch) {
    errors.push({
      description: errorMessage,
      filename: locationMatch[1]!,
      lineNumber: parseInt(locationMatch[2]!, 10),
      column: parseInt(locationMatch[3]!, 10),
    });
  } else {
    errors.push({ description: errorMessage });
  }

  return {
    type: 'error',
    body: {
      type: 'BuildError',
      message: errorMessage,
      errors,
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
      let codeFrame: {
        content: string;
        location: { row: number; column: number };
        fileName: string;
      } | null = null;
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
          } catch {
            /* file read failed */
          }
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

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
import type { WatchHandle, WatchRebuildEvent } from '@zts/core';
import * as jscSafeUrl from 'jsc-safe-url';
import { WebSocketServer, type WebSocket } from 'ws';

import type { ResolvedConfig } from '../../../config/types';
import { VERSION } from '../../../index';
import { watchWithNapi } from '../napi-build';
import { setupTerminalActions } from '../terminal-actions';
import { colors, logBundle, logInfo, logError, printBanner } from '../utils';
import { loadDevMiddleware, type DevMiddleware } from './dev-middleware';
import { handleAssetRequest } from './handlers/asset-handler';
import { sendIndexPage } from './handlers/index-handler';
import { handleOpenUrl } from './handlers/open-url-handler';
import { parseRequestUrl, readJsonBody, sendJson, sendText } from './utils';

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
 * ZTS `phaseDurations` 에서 트리 그룹 하나를 `label  k=Vms k=Vms ...` 한 줄로.
 */
function formatPhaseGroup(
  pd: NonNullable<WatchRebuildEvent['phaseDurations']>,
  label: string,
  keys: readonly (keyof NonNullable<WatchRebuildEvent['phaseDurations']>)[],
): string {
  return `${label}  ${keys.map((k) => `${k}=${pd[k]}ms`).join(' ')}`;
}

/**
 * HMR breakdown 로그 한 줄(또는 멀티라인) 생성.
 *
 * `BUNGAE_HMR_PROFILE=1` 비활성 시 빈 문자열. 활성 시 기본 phase 한 줄 `[...]`,
 * `ZTS_PROFILE=<cat>` 활성으로 sub 값이 하나라도 있으면 pipeline/graph/emit
 * 3 그룹 트리 구조 추가. `SUB_KEYS` 는 ZTS 의 sub-phase 스키마 변경 시 한 곳만 수정.
 */
function formatHmrBreakdown(event: WatchRebuildEvent): string {
  if (process.env.BUNGAE_HMR_PROFILE !== '1') return '';
  const pd = event.phaseDurations;
  if (!pd) return '';

  const reparsed = event.reparsedModules;
  const baseLine =
    `detect=${pd.detect}ms graph=${pd.graph}ms link=${pd.link}ms shake=${pd.shake}ms ` +
    `emit=${pd.emit}ms delta=${pd.delta}ms${reparsed !== undefined ? ` reparsed=${reparsed}` : ''}`;

  const SUB_KEYS = [
    'scan',
    'parse',
    'resolve',
    'semantic',
    'transform',
    'codegen',
    'metadata',
    'graphBuild',
    'graphWorker',
    'graphDiscover',
    'graphFinalize',
    'emitPolyfill',
    'emitRefresh',
    'emitOutput',
    'emitMetafile',
    'emitCss',
    'emitPrelude',
    'emitModulePass',
    'emitConcat',
    'emitSourcemapFinalize',
  ] as const;
  const hasSub = SUB_KEYS.some((k) => (pd[k] ?? 0) > 0);
  if (!hasSub) return ` [${baseLine}]`;

  return (
    ` [${baseLine}]` +
    '\n    ├─ ' +
    formatPhaseGroup(pd, 'pipeline', [
      'scan',
      'parse',
      'resolve',
      'semantic',
      'transform',
      'codegen',
      'metadata',
    ]) +
    '\n    ├─ ' +
    formatPhaseGroup(pd, 'graph   ', [
      'graphBuild',
      'graphWorker',
      'graphDiscover',
      'graphFinalize',
    ]) +
    '\n    ├─ ' +
    formatPhaseGroup(pd, 'emit    ', [
      'emitPolyfill',
      'emitRefresh',
      'emitOutput',
      'emitMetafile',
      'emitCss',
    ]) +
    '\n    └─ ' +
    formatPhaseGroup(pd, 'emit_out', [
      'emitPrelude',
      'emitModulePass',
      'emitConcat',
      'emitSourcemapFinalize',
    ])
  );
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
    /// postProcess 적용된 bundle sourcemap JSON. lazy 생성을 build 단위로 memoize.
    /// rebuild 마다 `onRebuild` 에서 null 로 invalidate. 같은 빌드 안에서 여러 symbolicate /
    /// `.map` 요청이 오면 재사용 (Metro 의 serializer 캐시와 유사).
    sourceMapCache: string | null;
    buildError: string | null;
    fileCount: number;
    lastRebuildTime: number;
  }

  /// build 단위 sourcemap cache 접근자. cache miss 시 lazy getter 호출 + postProcess.
  function getCachedSourceMap(state: PlatformState): string | null {
    if (state.sourceMapCache) return state.sourceMapCache;
    const raw = state.handle.getBundleSourceMap();
    if (!raw) return null;
    state.sourceMapCache = postProcessSourceMap(raw, config.root);
    return state.sourceMapCache;
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
          // Lazy sourcemap (ZTS #1727): `.map` 은 디스크에 없음 — `/index.map` 요청 시
          // `state.handle.getBundleSourceMap()` 를 lazy 호출.
          const sizeKB = (Buffer.byteLength(state!.bundle) / 1024).toFixed(1);
          const buildTime = Date.now() - buildStart;
          logBundle(
            'done',
            platform,
            `./${config.entry}`,
            `(${state!.fileCount} files, ${sizeKB} KB, ${buildTime}ms)`,
          );
        } else {
          state!.buildError = 'Build produced no output';
          logBundle('failed', platform, `./${config.entry}`, state!.buildError);
        }
      },
      onRebuild(event: WatchRebuildEvent) {
        const duration = event.phaseDurations?.total ?? Date.now() - state!.lastRebuildTime;
        state!.lastRebuildTime = Date.now();

        if (!event.success) {
          state!.buildError = event.error ?? 'Unknown build error';
          logError(`Build failed [${platform}]: ${state!.buildError}`);
          sendToClients(formatHmrError(state!.buildError));
          return;
        }

        state!.buildError = null;
        // rebuild 마다 lazy sourcemap cache invalidate — 다음 요청에서 getter 가 최신 swap 을 사용.
        state!.sourceMapCache = null;
        if (existsSync(outputPath)) {
          state!.bundle = readFileSync(outputPath, 'utf-8').replace(
            /\/\/# sourceMappingURL=[^\n]*/g,
            '',
          );
        }

        const changedCount = event.changed?.length ?? 0;
        const updatesCount = event.updates?.length ?? 0;

        const breakdown = formatHmrBreakdown(event);

        if (event.graphChanged) {
          logInfo(
            `Graph changed ${colors.dim}[${platform}] (${changedCount} files, ${duration}ms)${breakdown}${colors.reset}, full reload`,
          );
          sendToClients({ type: 'hmr:reload' });
        } else if (event.updates && event.updates.length > 0) {
          logInfo(
            `HMR update ${colors.dim}[${platform}] ${updatesCount} module(s) (${duration}ms)${breakdown}${colors.reset}`,
          );
          // 각 모듈 eval 코드 끝에 `sourceMappingURL` 주석을 추가해 DevTools 가 원본
          // sourcemap 을 lazy 라우트로 fetch 하게 한다. `sourceURL` 은 ZTS 가 emitter 에서
          // `//# sourceURL=<mod_id>` 로 이미 주입 — dev server 는 라우트 knowledge 가
          // 필요한 `sourceMappingURL` 만 담당 (관심사 분리).
          const annotatedModules = event.updates.map((u) => {
            const sourceMappingURL = `/__zts_hmr_map/${encodeURIComponent(u.id)}?platform=${platform}`;
            return { ...u, code: `${u.code}\n//# sourceMappingURL=${sourceMappingURL}\n` };
          });
          sendToClients({ type: 'hmr:update-start' });
          sendToClients({ type: 'hmr:update', modules: annotatedModules });
          sendToClients({ type: 'hmr:update-done' });
        } else if (changedCount > 0) {
          logInfo(
            `Rebuilt ${colors.dim}[${platform}] (${changedCount} files, ${duration}ms, no code change)${breakdown}${colors.reset}`,
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
      sourceMapCache: null,
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

    // Initial empty update sequence — Metro sends this on every HMR connect so
    // RN HMRClient.js fires `DevLoadingView.hide()` in its `update-done` handler,
    // dismissing the "Downloading 100%" bar. Without this the bar stays up on
    // reload/async-bundle paths where no file has changed yet.
    // `isInitialUpdate: true` tells the client to skip the "Refreshing..." banner.
    client.send(JSON.stringify({ type: 'hmr:update-start', isInitialUpdate: true }));
    client.send(JSON.stringify({ type: 'hmr:update-done' }));

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
    // Metro 호환: jsc-safe URL → normalize → user rewrite → normalize 재적용.
    // jscSafeUrl.toNormalUrl is idempotent for already-normal URLs, so the
    // double application is safe and matches Server.js:_rewriteAndNormalizeUrl.
    if (req.url) {
      const normalized = jscSafeUrl.toNormalUrl(req.url);
      const rewritten = server.rewriteRequestUrl(normalized);
      req.url = jscSafeUrl.toNormalUrl(rewritten);
    }
    const url = parseRequestUrl(req, hostname, port);

    // Symbolicate — dev middleware보다 먼저 처리 (RN LogBox 스택트레이스)
    if (url.pathname === '/symbolicate' && req.method === 'POST') {
      const platform = url.searchParams.get('platform') || defaultPlatform;
      const state = platforms.get(platform) || defaultState;
      // Lazy sourcemap (ZTS #1727). `getCachedSourceMap` 은 first-hit 에서 NAPI 로 10MB
      // JSON 을 sync 생성하며 event loop 을 수 ms~수십 ms block — 만약 request body 가
      // 완전히 도착하기 전에 호출되면 `readJsonBody` 의 `req.on('data')` 등록이 늦어
      // Node http (Bun 호환 포함) stream flow 가 꼬일 수 있다. 해소책: body 를 먼저
      // 읽은 뒤에 cache 조회.
      await handleSymbolicateRequest(req, res, config, state, config.symbolicator.customizeFrame);
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
      // Metro-style request line — yellow BUNDLE badge + platform + URL.
      logBundle('request', platform, `${url.pathname}${url.search}`);
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

    // HMR per-module sourcemap (ZTS #1727 Phase B lazy 라우트).
    // `/__zts_hmr_map/<encoded moduleId>` — eval 된 per-module code 의
    // `//# sourceMappingURL=` 주석이 가리키는 엔드포인트. ZTS handle 의 builder 를
    // 요청 시점에 JSON 직렬화.
    if (url.pathname.startsWith('/__zts_hmr_map/')) {
      const platform = url.searchParams.get('platform') || defaultPlatform;
      const state = platforms.get(platform) || defaultState;
      const moduleId = decodeURIComponent(url.pathname.slice('/__zts_hmr_map/'.length));
      const json = state.handle.getHmrSourceMap(moduleId);
      if (!json) {
        sendText(res, 404, 'HMR source map not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
        'Access-Control-Allow-Origin': 'devtools://devtools',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      res.end(json);
      return;
    }

    // Source map (Metro 호환: /index.map, /index.bundle.map). Lazy 전용 (ZTS #1727) —
    // Metro `_processSourceMapRequest` 패턴. dev watch 세션에서만 동작하며 디스크
    // fallback 은 두지 않는다. production 번들은 별도 `bundle` 명령을 쓴다.
    if (url.pathname.endsWith('.map') || url.pathname.endsWith('.bundle.map')) {
      const platform = url.searchParams.get('platform') || defaultPlatform;
      const state = platforms.get(platform) || defaultState;

      const json = getCachedSourceMap(state);
      if (!json) {
        sendText(res, 404, 'Source map not available');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
        'Access-Control-Allow-Origin': 'devtools://devtools',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      res.end(json);
      return;
    }

    // Symbolicate (스택트레이스 심볼리케이션) — 이미 handleRequest에서 처리
    if (url.pathname === '/symbolicate' && req.method === 'POST') {
      const platform = url.searchParams.get('platform') || defaultPlatform;
      const state = platforms.get(platform) || defaultState;
      await handleSymbolicateRequest(req, res, config, state, config.symbolicator.customizeFrame);
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

  // Wrap handleRequest as connect-style middleware so user-provided
  // server.enhanceMiddleware (Metro 호환) can intercept routes.
  // Plugins like @rozenite/metro use this to inject DevTools panels —
  // they handle their own paths and delegate the rest by calling next().
  const baseMiddleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): void => {
    handleRequest(req, res).then(
      () => {
        if (!res.headersSent && !res.writableEnded) next();
      },
      (err) => next(err),
    );
  };

  // Apply enhanceMiddleware. Second arg mirrors Metro's MetroServer slot —
  // Bungae has no Metro-shaped server object, so plugins must treat it as opaque.
  const enhancedMiddleware = server.enhanceMiddleware(baseMiddleware, {});

  const httpServer = createHttpServer((req, res) => {
    try {
      enhancedMiddleware(req, res, (err?: unknown) => {
        if (err) {
          logError(`Middleware error: ${err instanceof Error ? err.message : String(err)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Internal Server Error');
          }
        } else if (!res.headersSent) {
          res.statusCode = 404;
          res.end('Not Found');
        }
      });
    } catch (err) {
      logError(`Middleware threw: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    }
  });

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
        // sourceMap 은 lazy — handle 이 rebuild 마다 새로 캐시해 별도 invalidate 불필요.
        for (const state of platforms.values()) {
          state.bundle = null;
          state.buildError = null;
        }
      },
      projectRoot: config.root,
      port,
      broadcast: (method: string, params?: Record<string, any>) => broadcast(method, params ?? {}),
    });
    console.log('');
    logInfo(`Press ${colors.bold}?${colors.reset} to show keyboard shortcuts`);
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
  state: { handle: WatchHandle; sourceMapCache: string | null },
  customizeFrame: ResolvedConfig['symbolicator']['customizeFrame'],
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

    // 2) body 읽기 완료 후에 lazy sourcemap 조회 (build 단위 cache).
    const sourceMap = ((): string | null => {
      if (state.sourceMapCache) return state.sourceMapCache;
      const raw = state.handle.getBundleSourceMap();
      if (!raw) return null;
      state.sourceMapCache = postProcessSourceMap(raw, config.root);
      return state.sourceMapCache;
    })();

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
      const symbolicatedStack = await Promise.all(
        stack.map(async (frame) => {
          let resolved: typeof frame & { collapse?: boolean };
          if (!frame.file || frame.lineNumber == null) {
            resolved = { ...frame };
          } else {
            try {
              const pos = consumer.originalPositionFor({
                line: frame.lineNumber,
                column: frame.column ?? 0,
              });
              if (pos.source == null || pos.line == null) {
                resolved = { ...frame };
              } else {
                const { resolve } = require('path');
                let sourcePath = pos.source;
                if (!sourcePath.startsWith('/')) {
                  sourcePath = resolve(config.root, sourcePath);
                }
                resolved = {
                  ...frame,
                  file: sourcePath,
                  lineNumber: pos.line,
                  column: pos.column ?? 0,
                  methodName: pos.name ?? frame.methodName,
                };
              }
            } catch {
              resolved = { ...frame };
            }
          }

          // Apply user customizeFrame (Metro 호환). collapse: true → DevTools
          // 에서 프레임 숨김 처리 (사용자가 펼쳐서 볼 수 있음).
          try {
            const customization = await customizeFrame({
              file: resolved.file ?? null,
              lineNumber: resolved.lineNumber ?? null,
              column: resolved.column ?? null,
              methodName: resolved.methodName ?? null,
            });
            if (customization?.collapse) resolved.collapse = true;
          } catch {
            // user customizeFrame errors are non-fatal
          }

          return resolved;
        }),
      );

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

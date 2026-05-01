/**
 * ZTS NAPI Build — In-process bundling via @zts/core NAPI bindings
 *
 * Replaces runZtsBuild() (subprocess) with direct NAPI calls.
 * Converts ResolvedConfig to BuildOptions and manages plugins in-process.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

import {
  init,
  build,
  watch,
  type BuildOptions,
  type BuildResult,
  type WatchHandle,
  type WatchReadyEvent,
  type WatchRebuildEvent,
  type ZtsPlugin,
} from '@zts/core';

import type { ResolvedConfig } from '../../config/types';
import { VERSION } from '../../version';
import {
  createAssetPlugin,
  createBabelPlugin,
  createCodegenPlugin,
  createMetroResolveRequestPlugin,
  createRequireContextPlugin,
  type PluginConfig,
} from './napi-plugins';
import { RN_GLOBAL_IDENTIFIERS, tryResolve, resolveRnPolyfills } from './rn-constants';
import { logWarn } from './utils';

export { RN_GLOBAL_IDENTIFIERS, tryResolve, resolveRnPolyfills };

type BungaeZtsBuildOptions = BuildOptions & {
  entryErrorGuard?: boolean;
  silentConsoleErrorPatterns?: string[];
};

export async function resolveEffectiveTransformConfig(
  config: ResolvedConfig,
): Promise<ResolvedConfig> {
  const hook = config.transformer.getTransformOptions;
  if (!hook) return config;

  const entryFile = resolve(config.root, config.entry);
  const result = await hook(
    [entryFile],
    {
      dev: config.dev,
      hot: config.dev,
      platform: config.platform === 'web' ? null : config.platform,
      customTransformOptions: config.transformOptions,
    },
    () => [],
  );

  const inlineRequires = result?.transform?.inlineRequires;
  if (inlineRequires === undefined) return config;

  const nextConfig: ResolvedConfig = {
    ...config,
    transformer: {
      ...config.transformer,
      inlineRequires,
    },
  };

  if (inlineRequires === true || typeof inlineRequires === 'object') {
    const message =
      'transformer.getTransformOptions returned inlineRequires, but ZTS does not yet implement the inline require transform.';
    logWarn(message);
    config.reporter.update({ type: 'client_log', level: 'warn', data: [message] });
  }

  return nextConfig;
}

/**
 * tsconfig paths 중 ZTS alias로 안전하게 표현 가능한 trailing-wildcard 매핑을 읽는다.
 *
 * RN/Expo 템플릿의 `"@/*": ["./*"]` 같은 경로는 Metro가 기본적으로 해석하지만,
 * ZTS NAPI에는 별도로 전달해야 한다. 전달하지 않으면 HMR/개발 번들에서 일부
 * `require("@/...")`가 unresolved external처럼 남아 Hermes에서 실패한다.
 */
export function readTsConfigPathAliases(projectRoot: string): Record<string, string> {
  const configPath = join(projectRoot, 'tsconfig.json');
  if (!existsSync(configPath)) return {};

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      compilerOptions?: {
        baseUrl?: string;
        paths?: Record<string, string[]>;
      };
    };
    const paths = config.compilerOptions?.paths;
    if (!paths) return {};

    const baseUrl = config.compilerOptions?.baseUrl ?? '.';
    const aliases: Record<string, string> = {};

    for (const [key, targets] of Object.entries(paths)) {
      const firstTarget = targets?.[0];
      if (!firstTarget) continue;

      // ZTS alias는 prefix 치환이다. `@/* -> ./*`처럼 양쪽이 trailing wildcard인
      // 케이스만 prefix alias로 정확히 표현할 수 있다.
      if (!key.endsWith('/*') || !firstTarget.endsWith('/*')) continue;

      const aliasKey = key.slice(0, -2);
      const aliasTarget = firstTarget.slice(0, -2) || '.';
      if (!aliasKey) continue;

      aliases[aliasKey] = resolve(projectRoot, baseUrl, aliasTarget);
    }

    return aliases;
  } catch {
    return {};
  }
}

/**
 * 프로젝트 루트 기준으로 zts.node 경로를 탐색한다.
 * 번개 dist에서 실행될 때 @zts/core의 findAddon()이 경로를 못 찾으므로 직접 탐색.
 */
function findZtsAddon(projectRoot: string): string | undefined {
  const candidates = [
    join(projectRoot, 'zts/zig-out/lib/zts.node'),
    join(projectRoot, '../zts/zig-out/lib/zts.node'),
    resolve(projectRoot, '../../zts/zig-out/lib/zts.node'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

// ===== Config Conversion =====

/**
 * Build PluginConfig from ResolvedConfig for NAPI plugin factories.
 */
function getPluginConfig(config: ResolvedConfig): PluginConfig {
  return {
    projectRoot: config.root,
    assetExts: config.resolver.assetExts.map((e) => (e.startsWith('.') ? e : `.${e}`)),
    rnPlatform: config.platform === 'android' ? 'android' : 'ios',
    sourceExts: config.resolver.sourceExts.map((e) => (e.startsWith('.') ? e : `.${e}`)),
    babelTransformerPath: config.transformer.babelTransformerPath || undefined,
  };
}

/**
 * Convert ResolvedConfig to ZTS BuildOptions.
 *
 * Maps the same options that buildZtsArgs() in process.ts produces as CLI flags,
 * but as a structured object for the NAPI build() / watch() API.
 */
function buildNapiOptions(config: ResolvedConfig): BungaeZtsBuildOptions {
  const platform = config.platform === 'web' ? 'browser' : 'react-native';
  const rnPlatform =
    config.platform === 'ios' ? 'ios' : config.platform === 'android' ? 'android' : 'ios';

  const define: Record<string, string> = {};
  const plugins: ZtsPlugin[] = [];
  const polyfills: string[] = [];
  const runBeforeMain: string[] = [];
  const globalIdentifiers: string[] = [];

  // Build plugins from config
  const pluginConfig = getPluginConfig(config);
  plugins.push(createAssetPlugin(pluginConfig));

  // ZTS native codegen + JS plugin hybrid (#2348). `BUNGAE_CODEGEN_NATIVE=1` 일 때
  // ZTS 내장 plugin 이 *NativeComponent.{js,ts} 의 ~85% 를 inline (콜드 번들에서
  // per-file 재파싱 비용 제거). 나머지 ~15% (cross-file type, 미지원 패턴) 는 JS
  // plugin 이 fallback 으로 inline — 자동 상호 배타: ZTS 가 변환한 spec 은 코드에서
  // codegenNativeComponent 마커가 사라져 JS plugin 의 정규식 매칭 실패 → skip.
  // 결과: race condition 0 + ZTS 분만큼 lazy-load 비용 절감.
  plugins.push(createCodegenPlugin(pluginConfig));
  const useNativeCodegen = process.env.BUNGAE_CODEGEN_NATIVE === '1';

  plugins.push(createBabelPlugin(pluginConfig));

  const opts: BungaeZtsBuildOptions = {
    entryPoints: [resolve(config.root, config.entry)],
    platform,
    sourcemap: config.sourceMap || config.dev,
    minify: config.minify,
    plugins,
    // dev watch 세션은 lazy sourcemap 라우트 (`/bundle.js.map`, `/__zts_hmr_map/:id`) 로
    // serve 하므로 rebuild 경로의 `.map` 디스크 I/O 를 제거. production/one-shot 빌드는
    // 기본 true 유지 (디스크 산출물 필요).
    emitDiskSourcemap: !config.dev,
  };

  const tsConfigAliases = readTsConfigPathAliases(config.root);
  if (Object.keys(tsConfigAliases).length > 0) {
    opts.alias = {
      ...tsConfigAliases,
      ...(opts.alias ?? {}),
    };
  }

  // Metro 호환 watchFolders — 그래프 밖 디렉토리도 watch 루트에 추가.
  // ZTS는 dev mode(watch)에서만 의미있지만, 상수 비용이라 항상 전달.
  if (config.watchFolders && config.watchFolders.length > 0) {
    opts.watchFolders = config.watchFolders.map((p) => resolve(config.root, p));
  }

  // Metro resolver.blockList → ZTS blockList. RegExp는 .source로 변환됨 (@zts/core 어댑터에서).
  if (config.resolver.blockList && config.resolver.blockList.length > 0) {
    opts.blockList = config.resolver.blockList;
  }

  // Metro resolver.extraNodeModules → ZTS fallback. 일반 해석 실패 시에만 적용.
  // Metro는 string 값만 (절대경로), ZTS fallback은 string | false 지원.
  if (
    config.resolver.extraNodeModules &&
    Object.keys(config.resolver.extraNodeModules).length > 0
  ) {
    opts.fallback = { ...config.resolver.extraNodeModules };
  }

  // require.context (#1579) — ZTS Phase 2.5 onResolveContext hook.
  plugins.push(createRequireContextPlugin());

  // Metro resolver.resolveRequest — 사용자 정의 해석기를 ZTS onResolve 로 래핑.
  if (config.resolver.resolveRequest) {
    plugins.push(
      createMetroResolveRequestPlugin({
        resolveRequest: config.resolver.resolveRequest,
        platform: config.platform,
        customResolverOptions: config.resolverOptions,
        sourceExts: config.resolver.sourceExts,
        assetExts: config.resolver.assetExts,
        nodeModulesPaths: config.resolver.nodeModulesPaths,
        mainFields: ['react-native', 'browser', 'module', 'main'],
        preferNativePlatform: config.resolver.preferNativePlatform,
      }),
    );
  }

  // React Native specific options (CLI --platform=react-native 프리셋과 동일)
  if (platform === 'react-native') {
    opts.target = 'es5';
    opts.flow = true;
    opts.jsxInJs = true;
    opts.configurableExports = true;
    opts.strictExecutionOrder = true;
    opts.entryErrorGuard = true;
    opts.workletTransform = true;
    // ZTS native codegen — JS 플러그인은 hybrid 로 항상 활성 (fallback). 본 옵션은
    // ZTS 측 transform 훅 활성화. ZTS 가 처리하면 JS plugin 의 정규식 매칭 실패로 skip.
    opts.codegenTransform = useNativeCodegen;

    // Reanimated runtime의 jsVersion과 대조를 위해 사용자 설치 worklets 패키지 버전을 주입.
    // 불일치 시 __DEV__ 모드에서 WorkletsError throw (serializable.native.ts:464).
    // Node resolution algorithm 사용 — 모노레포(Yarn workspaces, pnpm) 호이스팅된
    // 경로도 부모 디렉토리 traversal로 탐지.
    try {
      const pkgPath = require.resolve('react-native-worklets/package.json', {
        paths: [config.root],
      });
      const wkPkg = require(pkgPath);
      if (wkPkg?.version) opts.workletPluginVersion = wkPkg.version;
    } catch {
      // 패키지 미설치/resolve 실패 — ZTS 기본 상수 사용
    }

    // resolve extensions: 플랫폼별 확장자 순서 (Metro/CLI 프리셋 호환)
    const nativeAndBase = [
      '.native.ts',
      '.native.tsx',
      '.native.js',
      '.native.jsx',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.json',
    ];
    if (rnPlatform === 'ios') {
      opts.resolveExtensions = ['.ios.ts', '.ios.tsx', '.ios.js', '.ios.jsx', ...nativeAndBase];
    } else if (rnPlatform === 'android') {
      opts.resolveExtensions = [
        '.android.ts',
        '.android.tsx',
        '.android.js',
        '.android.jsx',
        ...nativeAndBase,
      ];
    } else {
      opts.resolveExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json'];
    }

    // main fields: RN → browser → module → main
    opts.mainFields = ['react-native', 'browser', 'module', 'main'];

    // ZTS native asset handling — file loader + AssetRegistry 래핑.
    // 번개 createAssetPlugin의 onLoad 처리를 ZTS 코어로 위임 (NAPI 왕복 제거).
    // assetRegistry는 RN 프리셋이 자동 설정하므로 별도 지정 불필요.
    const assetLoaders: Record<string, string> = {};
    for (const ext of config.resolver.assetExts) {
      assetLoaders[ext.startsWith('.') ? ext : `.${ext}`] = 'file';
    }
    opts.loader = { ...assetLoaders, ...(opts.loader ?? {}) };

    // AssetRegistry alias 제거: `react-native/Libraries/Image/AssetRegistry`가
    // `@react-native/assets-registry/registry`를 re-export하므로, alias로 두 경로를
    // 같은 모듈로 해석하면 self-cycle re-export가 발생해 ZTS가 자기 참조 getter를
    // 생성한다. 두 경로를 별개 모듈로 두면 named re-export 정상 처리.
    opts.alias = {
      ...(opts.alias ?? {}),
    };

    // global -> __BUNGAE_GLOBAL__ substitution (preserve native Hermes global)
    define['global'] = '__BUNGAE_GLOBAL__';

    // JSX runtime
    if (config.dev) {
      opts.jsx = 'automatic-dev';
      // ZTS dev mode: __zts_register() wrapping + HMR runtime + React Refresh
      opts.devMode = true;
      opts.reactRefresh = true;
      opts.collectModuleCodes = true;

      // DevLoadingView hide workaround
      // + __BUNGAE_BUNDLER__ / __BUNGAE_VERSION__
      //
      // **중요**: iOS 26.4+ Hermes 는 top-level `globalThis.X = ...` 구문을 감지하면
      // spec global (`Location`, `TextEncoderStream` 등) placeholder 를 lazy 등록한다.
      // placeholder 가 `configurable: false` 이므로 그 후 expo-metro-runtime 의
      // `Location.install()` 이 `Object.defineProperty(global, 'Location', ...)` 시도 →
      // throw → 부팅 실패. Metro bundle 은 모든 globalThis assignment 를 module factory
      // 안(nested) 에 두기 때문에 이 trigger 를 피함.
      //
      // ZTS 도 같은 mechanism — bungae 식별자는 IIFE 로 wrap 해서 *local var* 에
      // assignment 하는 형태로 emit. 사용자 앱은 동일하게 `globalThis.__BUNGAE_BUNDLER__`
      // 로 read 가능 (실제로는 globalThis 위에 올라감).
      const footer = [
        `(function(g){g.__BUNGAE_BUNDLER__=true;g.__BUNGAE_VERSION__=${JSON.stringify(VERSION)};})(typeof globalThis!=='undefined'?globalThis:typeof global!=='undefined'?global:typeof window!=='undefined'?window:this);`,
        'setTimeout(function(){try{NativeModules.DevLoadingView.hide()}catch(e){}},0);',
      ].join('');
      opts.footer = footer;
    }

    // RN prelude — Metro prelude 와 문법적으로 정확히 동등하게. Metro 는:
    //   `var __BUNDLE_START_TIME__=globalThis.nativePerformanceNow?...,__DEV__=true,process=globalThis.process||{},...`
    // (comma-separated 단일 var statement, `globalThis.X` access) 형태.
    // ZTS 도 같은 문법으로 — Hermes 의 parse 시점 static analysis 가 spec global
    // placeholder 등록을 trigger 하는 어떤 pattern 을 피할 가능성. 검증 중.
    const prelude =
      `var __BUNDLE_START_TIME__=globalThis.nativePerformanceNow?nativePerformanceNow():Date.now(),` +
      `__DEV__=${config.dev},` +
      `process=globalThis.process||{};` +
      `process.env=process.env||{};` +
      `process.env.NODE_ENV=process.env.NODE_ENV||"${config.dev ? 'development' : 'production'}";` +
      `var __BUNGAE_GLOBAL__=typeof globalThis!=='undefined'?globalThis:typeof global!=='undefined'?global:typeof window!=='undefined'?window:this;` +
      `if(typeof global==='undefined')var global=__BUNGAE_GLOBAL__;`;
    opts.banner = prelude;

    // Compile-time defines (override ZTS auto-define)
    define['__DEV__'] = String(config.dev);
    define['process.env.NODE_ENV'] = `"${config.dev ? 'development' : 'production'}"`;

    // Expo Router env (`_ctx.{ios,android,web}.tsx` 의 require.context 인자에 사용).
    // ZTS Phase 2.6 의 import_scanner evaluator 가 이 값들을 보고 require.context 의
    // process.env.X 인자를 정적 평가. (#1579 / #1582 Tier 2)
    // 절대 경로로 전달 — `_ctx.ios.js` 가 `node_modules/.bun/expo-router/...` 안에 있어
    // importer 기준 `"./app"` 은 잘못된 경로를 가리킴 (Metro 도 importer 기준 user
    // app 경로로 치환). onResolveContext 의 `resolve(dirname(importer), dir)` 는
    // dir 가 절대 경로면 그대로 사용.
    define['process.env.EXPO_ROUTER_APP_ROOT'] = JSON.stringify(resolve(config.root, 'app'));
    define['process.env.EXPO_ROUTER_IMPORT_MODE'] = '"sync"';
    define['process.env.EXPO_OS'] =
      `"${config.platform === 'web' ? 'web' : config.platform === 'android' ? 'android' : 'ios'}"`;

    // Polyfills: console.js, error-guard.js — IIFE-wrapped, executed at bundle start
    for (const polyfillPath of resolveRnPolyfills(config.root)) {
      polyfills.push(polyfillPath);
    }

    // runBeforeMainModule — Metro entry trigger 순서:
    //   1. InitializeCore (RN core, MUST be first)
    //   2. ...config.serializer.runBeforeMainModule (사용자 / withExpo() 등 통합이 채움)
    // 각 path는 ZTS의 별 outer guardedLoadModule layer로 emit되므로 한 layer
    // throw (예: iOS 26.4 `Location` placeholder)가 다음 layer 평가를 막지 않음.
    const initCorePath = tryResolve('react-native/Libraries/Core/InitializeCore', config.root);
    if (initCorePath) {
      runBeforeMain.push(initCorePath);
    }
    if (config.serializer.runBeforeMainModule.length > 0) {
      runBeforeMain.push(...config.serializer.runBeforeMainModule);
    }

    // Server-level dev console suppression (Metro에 없는 Bungae 자체 mechanism).
    // `withExpo()`가 winter polyfill warning 패턴을 채워 넣음.
    if (config.server.silentConsoleErrorPatterns.length > 0) {
      opts.silentConsoleErrorPatterns = [...config.server.silentConsoleErrorPatterns];
    }

    // Reserved global identifiers — prevent scope hoisting collisions
    for (const name of RN_GLOBAL_IDENTIFIERS) {
      globalIdentifiers.push(name);
    }
  }

  // Apply accumulated arrays/objects
  opts.define = define;
  if (polyfills.length > 0) opts.polyfills = polyfills;
  if (runBeforeMain.length > 0) opts.runBeforeMain = runBeforeMain;
  if (globalIdentifiers.length > 0) opts.globalIdentifiers = globalIdentifiers;

  return opts;
}

// ===== Public API =====

export interface NapiBuildResult {
  code: string;
  map?: string;
  /** Per-module codes for HMR (dev mode only) */
  moduleCodes?: Array<{ id: string; code: string }>;
  /** All module paths in the bundle */
  modulePaths?: string[];
}

/**
 * Build with NAPI — in-process replacement for runZtsBuild().
 *
 * Uses @zts/core build() with JS plugins running in the same process.
 * No subprocess, no IPC overhead.
 */
export async function buildWithNapi(
  config: ResolvedConfig,
  outputPath?: string,
): Promise<NapiBuildResult> {
  init(findZtsAddon(config.root));

  const effectiveConfig = await resolveEffectiveTransformConfig(config);
  const opts = buildNapiOptions(effectiveConfig);

  // If outputPath specified, write to disk
  if (outputPath) {
    opts.outfile = outputPath;
    opts.write = true;
  }

  const result: BuildResult = await build(opts);

  if (result.errors.length > 0) {
    const errorMessages = result.errors
      .map((e) => (e.location?.file ? `${e.location.file}: ${e.text}` : e.text))
      .join('\n');
    throw new Error(`[zts] Build failed:\n${errorMessages}`);
  }

  // Extract code and sourcemap from output files
  const mainOutput = result.outputFiles.find((f) => !f.path.endsWith('.map'));
  const mapOutput = result.outputFiles.find((f) => f.path.endsWith('.map'));

  return {
    code: mainOutput?.text ?? '',
    map: mapOutput?.text,
    moduleCodes: (result as any).moduleCodes,
    modulePaths: (result as any).modulePaths,
  };
}

export interface NapiWatchResult {
  /** Stop watching and release resources */
  handle: WatchHandle;
}

/**
 * Watch with NAPI — in-process replacement for spawnZtsWatch().
 *
 * Uses @zts/core watch() with callbacks instead of NDJSON parsing.
 * Returns a handle to stop watching.
 */
export function watchWithNapi(
  config: ResolvedConfig,
  outputPath: string,
  callbacks?: {
    onReady?: (event: WatchReadyEvent) => void;
    onRebuild?: (event: WatchRebuildEvent) => void;
  },
): NapiWatchResult {
  init(findZtsAddon(config.root));

  const opts = buildNapiOptions(config);
  opts.outfile = outputPath;
  opts.write = true;

  // Wire up watch callbacks
  if (callbacks?.onReady) {
    opts.onReady = callbacks.onReady;
  }
  if (callbacks?.onRebuild) {
    opts.onRebuild = callbacks.onRebuild;
  }

  const handle = watch(opts);

  return { handle };
}

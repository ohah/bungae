/**
 * ZTS NAPI Build — In-process bundling via @zts/core NAPI bindings
 *
 * Replaces runZtsBuild() (subprocess) with direct NAPI calls.
 * Converts ResolvedConfig to BuildOptions and manages plugins in-process.
 */

import { existsSync } from 'fs';
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
  type PluginConfig,
} from './napi-plugins';
import { RN_GLOBAL_IDENTIFIERS, tryResolve, resolveRnPolyfills } from './rn-constants';

export { RN_GLOBAL_IDENTIFIERS, tryResolve, resolveRnPolyfills };

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
function buildNapiOptions(config: ResolvedConfig): BuildOptions {
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
  plugins.push(createCodegenPlugin(pluginConfig));
  plugins.push(createBabelPlugin(pluginConfig));

  const opts: BuildOptions = {
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

  // Metro resolver.resolveRequest → ZTS onResolve 플러그인 콜백.
  // Metro 시그니처(context, moduleName, platform) 그대로 호출. 위임 시 throw로 ZTS 기본 해석기 사용.
  if (config.resolver.resolveRequest) {
    const userResolveRequest = config.resolver.resolveRequest;
    plugins.push({
      name: 'bungae:metro-resolve-request',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          // ZTS 기본 해석기로 위임하는 함수 — Metro는 context.resolveRequest 호출로 표현.
          // throw하면 ZTS가 기본 해석 진행 (return null과 동일).
          const fallbackResolver = () => {
            throw new Error('__BUNGAE_DELEGATE_TO_DEFAULT__');
          };
          try {
            const result = userResolveRequest(
              {
                originModulePath: args.importer ?? '',
                platform: config.platform === 'web' ? null : config.platform,
                resolveRequest: fallbackResolver as never,
              },
              args.path,
              config.platform === 'web' ? null : config.platform,
            );
            if (result.type === 'sourceFile') return { path: result.filePath };
            if (result.type === 'assetFiles') return { path: result.filePaths[0] ?? args.path };
            // Metro `{ type: 'empty' }` → ZTS `disabled` flag (빈 모듈로 처리).
            // ZTS가 자동으로 module.exports = {} 출력 — 별도 onLoad 불필요.
            if (result.type === 'empty') return { disabled: true };
          } catch (err) {
            if ((err as Error).message === '__BUNGAE_DELEGATE_TO_DEFAULT__') return null;
            throw err;
          }
          return null;
        });
      },
    });
  }

  // React Native specific options (CLI --platform=react-native 프리셋과 동일)
  if (platform === 'react-native') {
    opts.target = 'es5';
    opts.flow = true;
    opts.jsxInJs = true;
    opts.configurableExports = true;
    opts.strictExecutionOrder = true;
    opts.workletTransform = true;

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
      const hideLoadingView =
        'setTimeout(function(){try{NativeModules.DevLoadingView.hide()}catch(e){}},0);';
      opts.footer = hideLoadingView;
    }

    // RN prelude (Metro prelude equivalent)
    const prelude = [
      `var __BUNDLE_START_TIME__=this.nativePerformanceNow?nativePerformanceNow():Date.now();`,
      `var __DEV__=${config.dev};`,
      `var __BUNGAE_GLOBAL__=typeof globalThis!=='undefined'?globalThis:typeof global!=='undefined'?global:typeof window!=='undefined'?window:this;`,
      `if(typeof global==='undefined')var global=__BUNGAE_GLOBAL__;`,
      `var process=__BUNGAE_GLOBAL__.process||{};process.env=process.env||{};process.env.NODE_ENV=process.env.NODE_ENV||"${config.dev ? 'development' : 'production'}";`,
      `globalThis.__BUNGAE_BUNDLER__=true;globalThis.__BUNGAE_VERSION__=${JSON.stringify(VERSION)};`,
    ].join('');
    opts.banner = prelude;

    // Compile-time defines (override ZTS auto-define)
    define['__DEV__'] = String(config.dev);
    define['process.env.NODE_ENV'] = `"${config.dev ? 'development' : 'production'}"`;

    // Polyfills: console.js, error-guard.js — IIFE-wrapped, executed at bundle start
    for (const polyfillPath of resolveRnPolyfills(config.root)) {
      polyfills.push(polyfillPath);
    }

    // InitializeCore: runs before entry module (Metro runBeforeMainModule)
    const initCorePath = tryResolve('react-native/Libraries/Core/InitializeCore', config.root);
    if (initCorePath) {
      runBeforeMain.push(initCorePath);
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

  const opts = buildNapiOptions(config);

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

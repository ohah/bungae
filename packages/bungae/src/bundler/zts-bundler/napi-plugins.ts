/**
 * ZTS NAPI Plugin Factories
 *
 * Creates ZtsPlugin instances for in-process NAPI build/watch.
 * Uses shared logic from plugin-core.ts (no IPC, no subprocess).
 */

import { readdirSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

import type { ZtsPlugin } from '@zts/core';

import type { CustomResolver, Platform } from '../../config/types';
import {
  ZTS_HMR_CLIENT_CODE,
  HMR_CLIENT_SUFFIX,
  detectCustomPlugins,
  createBabelTransformer,
  createCodegenTransformer,
  escapeRegex,
  type BabelOptions,
} from './plugin-core';

export interface PluginConfig {
  projectRoot: string;
  assetExts: string[];
  rnPlatform: 'ios' | 'android';
  sourceExts: string[];
  /** Metro-compatible custom file transformer path (e.g. react-native-svg-transformer) */
  babelTransformerPath?: string;
}

/**
 * React Native runtime injection plugin for NAPI build.
 *
 * 다음만 처리 (Node.js API 또는 Metro 정확 호환이 필요한 케이스):
 * - HMRClient.js 교체 — Metro의 HMRClient를 ZTS HMR 클라이언트로 (Node fs 인젝션)
 * - babelTransformerPath — react-native-svg-transformer 등 커스텀 transformer (Node require)
 *
 * 에셋 처리(AssetRegistry redirect, registerAsset 코드 생성)는 ZTS 코어가 직접 처리.
 * `napi-build.ts`에서 `assetRegistry` + `loader` + `alias` 옵션으로 위임.
 */
export function createAssetPlugin(config: PluginConfig): ZtsPlugin {
  return {
    name: 'bungae:react-native-runtime',
    setup(build) {
      // HMRClient.js 교체 — ZTS HMR 코드를 직접 인젝트.
      // Node fs로 런타임 코드를 읽어 인라인하므로 ZTS 코어로 옮길 수 없음.
      const hmrClientPattern = new RegExp(escapeRegex(HMR_CLIENT_SUFFIX) + '$');
      build.onLoad({ filter: hmrClientPattern }, () => ({
        contents: ZTS_HMR_CLIENT_CODE,
      }));

      // 커스텀 babelTransformerPath (Metro 호환).
      // Metro transformer는 `transform({ src, filename, options })` 시그니처로 호출하고
      // `{ ast }` 또는 `{ code }`를 받음. AST면 babel로 generate하여 코드로 변환.
      // Node require + babel이 필요하므로 ZTS 코어로 옮길 수 없음.
      if (config.babelTransformerPath) {
        let customTransformer: any = null;
        let babel: any = null;
        const transformerPath = config.babelTransformerPath;

        const customExts = config.sourceExts
          .filter((e) => !/^\.(tsx?|jsx?|mjs|cjs|json)$/.test(e))
          .map((e) => e.replace(/^\./, ''))
          .join('|');

        if (customExts) {
          const customExtPattern = new RegExp(`\\.(${customExts})$`);
          build.onLoad({ filter: customExtPattern }, async (args) => {
            try {
              if (!customTransformer) {
                customTransformer = require(
                  require.resolve(transformerPath, { paths: [config.projectRoot] }),
                );
              }
              if (!babel) {
                babel = require('@babel/core');
              }
              const fs = require('fs');
              const src = fs.readFileSync(args.path, 'utf8');
              const result = await customTransformer.transform({
                src,
                filename: args.path,
                options: { platform: config.rnPlatform, dev: true },
              });
              if (result?.code) return { contents: result.code };
              if (result?.ast) {
                const generated = babel.transformFromAstSync(result.ast, undefined, {
                  filename: args.path,
                  babelrc: false,
                  configFile: false,
                });
                if (generated?.code) return { contents: generated.code };
              }
            } catch (e: any) {
              process.stderr.write(
                `[bungae:transformer] ${args.path.split('/').pop()}: ${e.message?.slice(0, 100)}\n`,
              );
            }
            return null;
          });
        }
      }
    },
  };
}

/**
 * Babel transform plugin for NAPI build.
 *
 * Runs user-configured Babel plugins (reanimated, nativewind, worklet) on source files.
 * Only activates when custom plugins are detected in babel.config.js.
 * Babel is lazy-loaded on first transform to avoid startup latency.
 */
export function createBabelPlugin(config: PluginConfig, opts: BabelOptions = {}): ZtsPlugin {
  return {
    name: 'bungae:babel-transform',
    setup(build) {
      // bypassAllowlist 일 때는 detectCustomPlugins 건너뜀 — plugin 0 개여도 babel 활성.
      if (!opts.bypassAllowlist && !detectCustomPlugins(config.projectRoot)) return;

      const transformer = createBabelTransformer(config.projectRoot, {
        bypassAllowlist: opts.bypassAllowlist,
      });

      const extPatterns = config.sourceExts.map((e) => e.replace(/^\./, '')).join('|');
      const sourcePattern = new RegExp(`\\.(${extPatterns})$`);

      build.onTransform({ filter: sourcePattern }, (args) => {
        // Skip node_modules — custom plugins only apply to user code
        if (args.path.includes('node_modules')) return null;

        try {
          const result = transformer(args.code, args.path);
          return result ? { code: result } : null;
        } catch {
          // Babel errors are logged by the transformer; don't break the build
          return null;
        }
      });
    },
  };
}

/**
 * require.context (#1579) — ZTS 가 인지/메타만, 매칭은 host (Bun JSC RegExp) 책임.
 * ZTS Phase 2.5 의 onResolveContext hook.
 *
 * 디렉토리 FS scan → filter regex 매칭 → 결정적 정렬된 상대경로 리스트 반환.
 * projectRoot 등 config 의존성 없음 — importer 기준 상대 경로만 사용.
 */
export function createRequireContextPlugin(): ZtsPlugin {
  return {
    name: 'bungae:require-context',
    setup(build) {
      build.onResolveContext({ filter: /.*/ }, (args) => {
        const { dir, recursive, filter, flags, importer } = args;
        const absDir = resolve(dirname(importer), dir);

        let entries: string[];
        try {
          if (recursive) {
            entries = readdirSync(absDir, { recursive: true, withFileTypes: true })
              .filter((d) => d.isFile())
              .map((d) => {
                const parent = (d as unknown as { parentPath?: string }).parentPath ?? absDir;
                return relative(absDir, join(parent, d.name));
              });
          } else {
            entries = readdirSync(absDir, { withFileTypes: true })
              .filter((d) => d.isFile())
              .map((d) => d.name);
          }
        } catch {
          // 디렉토리 없음 → empty (graph 가 invalid 처리하지 않도록 응답)
          return { context: [] };
        }

        // Filter regex (Bun JSC RegExp). 기본은 Metro/webpack 의 `^\\./.*$`.
        const re = filter ? new RegExp(filter, flags ?? '') : /^\.\/.*$/;
        const matched = entries
          .map((f) => './' + f.replace(/\\/g, '/'))
          .filter((p) => re.test(p))
          .sort(); // 결정적 순서

        return { context: matched };
      });
    },
  };
}

/**
 * Metro resolver.resolveRequest → ZTS onResolve 플러그인 콜백.
 *
 * Metro 시그니처(context, moduleName, platform) 그대로 호출.
 * 위임 시 throw 로 ZTS 기본 해석기 사용 (Metro 의 `context.resolveRequest()` 호출과 동등).
 */
export interface MetroResolveRequestOptions {
  resolveRequest: CustomResolver;
  platform: Platform;
  customResolverOptions?: Record<string, string>;
  sourceExts?: readonly string[];
  assetExts?: readonly string[];
  nodeModulesPaths?: readonly string[];
  mainFields?: readonly string[];
  preferNativePlatform?: boolean;
  unstable_enablePackageExports?: boolean;
  unstable_conditionNames?: readonly string[];
  unstable_conditionsByPlatform?: Readonly<Record<string, readonly string[]>>;
}

export function createMetroResolveRequestPlugin(opts: MetroResolveRequestOptions): ZtsPlugin {
  const { resolveRequest, platform } = opts;
  const metroPlatform = platform === 'web' ? null : platform;

  return {
    name: 'bungae:metro-resolve-request',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // ZTS 기본 해석기로 위임하는 함수 — Metro 는 context.resolveRequest 호출로 표현.
        // throw 하면 ZTS 가 기본 해석 진행 (return null 과 동일).
        const fallbackResolver = () => {
          throw new Error('__BUNGAE_DELEGATE_TO_DEFAULT__');
        };
        try {
          const result = resolveRequest(
            {
              originModulePath: args.importer ?? '',
              platform: metroPlatform,
              resolveRequest: fallbackResolver as never,
              customResolverOptions: opts.customResolverOptions ?? {},
              sourceExts: opts.sourceExts ?? [],
              assetExts: opts.assetExts ?? [],
              nodeModulesPaths: opts.nodeModulesPaths ?? [],
              mainFields: opts.mainFields ?? [],
              preferNativePlatform: opts.preferNativePlatform ?? true,
              unstable_enablePackageExports: opts.unstable_enablePackageExports,
              unstable_conditionNames: opts.unstable_conditionNames,
              unstable_conditionsByPlatform: opts.unstable_conditionsByPlatform,
            },
            args.path,
            metroPlatform,
          );
          if (result.type === 'sourceFile') return { path: result.filePath };
          if (result.type === 'assetFiles') return { path: result.filePaths[0] ?? args.path };
          // Metro `{ type: 'empty' }` → ZTS `disabled` flag (빈 모듈로 처리).
          // ZTS 가 자동으로 module.exports = {} 출력 — 별도 onLoad 불필요.
          if (result.type === 'empty') return { disabled: true };
        } catch (err) {
          if ((err as Error).message === '__BUNGAE_DELEGATE_TO_DEFAULT__') return null;
          throw err;
        }
        return null;
      });
    },
  };
}

/**
 * RN codegen view config 인라인 플러그인 — `@react-native/codegen` 직접 호출.
 *
 * ZTS가 `@react-native/babel-preset`을 네이티브 처리하지만 내부의 codegen 플러그인은 미구현이라,
 * `codegenNativeComponent<Props>('Name')` 호출이 런타임에 그대로 실행됨. RN 0.85+ New Arch에서
 * Fabric의 자동 컴포넌트 등록이 늘어나면서 View config not found 크래시 유발 (DebuggingOverlay 등).
 *
 * 이 플러그인은 node_modules 포함 모든 `.js`/`.ts` 파일에서 `export default codegenNativeComponent`
 * spec만 schema화한 뒤 view config를 static 객체로 치환.
 *
 * ZTS 네이티브 구현은 ohah/zts#1589 참고.
 */
export function createCodegenPlugin(config: PluginConfig): ZtsPlugin {
  return {
    name: 'bungae:codegen-view-config',
    setup(build) {
      const transformer = createCodegenTransformer(config.projectRoot);

      // .js, .ts 만 (플러그인이 .jsx/.tsx 미지원 — RN NativeComponent 파일은 항상 .js)
      build.onTransform({ filter: /\.(js|ts)$/ }, (args) => {
        try {
          const result = transformer(args.code, args.path);
          return result ? { code: result } : null;
        } catch {
          return null;
        }
      });
    },
  };
}

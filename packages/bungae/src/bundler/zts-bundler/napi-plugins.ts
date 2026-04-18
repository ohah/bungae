/**
 * ZTS NAPI Plugin Factories
 *
 * Creates ZtsPlugin instances for in-process NAPI build/watch.
 * Uses shared logic from plugin-core.ts (no IPC, no subprocess).
 */

import type { ZtsPlugin } from '@zts/core';

import {
  ZTS_HMR_CLIENT_CODE,
  HMR_CLIENT_SUFFIX,
  detectCustomPlugins,
  createBabelTransformer,
  createCodegenTransformer,
  escapeRegex,
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
export function createBabelPlugin(config: PluginConfig): ZtsPlugin {
  return {
    name: 'bungae:babel-transform',
    setup(build) {
      // Skip entirely if no custom Babel plugins detected
      if (!detectCustomPlugins(config.projectRoot)) return;

      const transformer = createBabelTransformer(config.projectRoot);

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
 * RN codegen view config 인라인 플러그인 — `@react-native/babel-plugin-codegen` 래핑.
 *
 * ZTS가 `@react-native/babel-preset`을 네이티브 처리하지만 내부의 codegen 플러그인은 미구현이라,
 * `codegenNativeComponent<Props>('Name')` 호출이 런타임에 그대로 실행됨. RN 0.85+ New Arch에서
 * Fabric의 자동 컴포넌트 등록이 늘어나면서 View config not found 크래시 유발 (DebuggingOverlay 등).
 *
 * 이 플러그인은 node_modules 포함 모든 `.js`/`.ts` 파일에서 `codegenNativeComponent` 마커를 가진
 * 파일만 Babel로 한번 더 돌려서 view config를 static 객체로 치환.
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

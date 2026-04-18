/**
 * ZTS Plugin Core — HMR client + Babel transformer dispatch helpers.
 *
 * Asset 처리(AssetRegistry, registerAsset 코드 생성, scale variant 묶기)는
 * ZTS 코어가 직접 수행하므로 여기엔 없음 (napi-build.ts의 assetRegistry/loader/alias 옵션 참조).
 * 남은 함수들은 Node API(fs/require)에 의존해서 ZTS Zig로 옮길 수 없는 것들.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// ===== Constants =====

/** ZTS HMR client code (loaded from dist/runtime or fallback dummy) */
export const ZTS_HMR_CLIENT_CODE = (() => {
  try {
    return readFileSync(join(__dirname, 'runtime/zts-hmr-client.js'), 'utf-8');
  } catch {
    return 'module.exports = { setup() {}, enable() {}, disable() {}, registerBundle() {}, log() {} }; module.exports.default = module.exports;';
  }
})();

/** HMRClient.js path suffix for onLoad interception */
export const HMR_CLIENT_SUFFIX = '/Libraries/Utilities/HMRClient.js';

/** iOS scale variant 화이트리스트 — production build에서 @4x 등 제외 시 사용 (build.ts) */
export const IOS_SCALES = new Set([1, 2, 3]);

export const SCALE_REGEX = /@(\d+(?:\.\d+)?)x/;

// ===== Asset Code Generation =====

/**
 * Compute Metro-compatible httpServerLocation for an asset.
 * Normalizes leading ../ for assets outside project root (e.g., node_modules).
 */
export function computeHttpServerLocation(filePath: string, projectRoot: string): string {
  const assetDir = dirname(filePath);
  let relativePath = relative(projectRoot, assetDir).replace(/\\/g, '/');
  while (relativePath.startsWith('../')) relativePath = relativePath.slice(3);
  if (relativePath === '..') relativePath = '';
  return relativePath && relativePath !== '.' ? `/assets/${relativePath}` : '/assets';
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===== Babel Plugin Detection & Transformer =====

/**
 * Babel plugin patterns that ZTS handles natively — excluded from Babel pass-through.
 * Everything NOT in this list is forwarded to Babel automatically.
 */
const ZTS_NATIVE_PLUGIN_PATTERNS = [
  // ZTS ES5 매트릭스가 처리하는 변환
  'optional-chaining',
  'nullish-coalescing',
  'class-properties',
  'private-methods',
  'private-property-in-object',
  'flow-strip-types',
  'transform-flow',
  'transform-typescript',
  'transform-react-jsx',
  'transform-arrow-functions',
  'transform-block-scoping',
  'transform-shorthand-properties',
  'transform-template-literals',
  'transform-modules-commonjs',
  // ZTS 네이티브 워크릿 변환 (#1082)
  'react-native-worklets',
  'react-native-reanimated/plugin',
  'react-native-reanimated',
  // RN 기본 프리셋 (ZTS가 전체 처리)
  '@react-native/babel-preset',
];

/**
 * Detect whether the project has custom Babel plugins that require runtime transformation.
 * Checks babel.config.js for plugins matching known patterns (reanimated, nativewind, worklet).
 *
 * @param projectRoot  Project root directory containing babel.config.js
 */
/**
 * Check if a plugin name is handled natively by ZTS (should NOT be forwarded to Babel).
 */
function isZtsNativePlugin(name: string): boolean {
  return ZTS_NATIVE_PLUGIN_PATTERNS.some((pattern) => name.includes(pattern));
}

export function detectCustomPlugins(projectRoot: string): boolean {
  try {
    const configPath = join(projectRoot, 'babel.config.js');
    if (!existsSync(configPath)) return false;
    const config = require(configPath);
    const plugins: unknown[] = config?.plugins || [];
    // Any plugin NOT handled natively by ZTS → needs Babel
    return plugins.some((p) => {
      const name = typeof p === 'string' ? p : Array.isArray(p) ? p[0] : '';
      return typeof name === 'string' && !isZtsNativePlugin(name);
    });
  } catch {
    return false;
  }
}

/**
 * Create a lazy-loaded Babel transformer for custom plugins.
 * Babel and its config are loaded on first invocation to avoid startup latency.
 *
 * @param projectRoot  Project root directory containing babel.config.js
 * @returns  A transformer function: (code, filename) => transformed code or null
 */
export function createBabelTransformer(
  projectRoot: string,
): (code: string, filename: string) => string | null {
  let babel: any = null;
  let babelOptions: any = null;

  function ensureBabel() {
    if (babel) return;
    babel = require('@babel/core');

    const configPath = join(projectRoot, 'babel.config.js');
    const config = require(configPath);
    const plugins: unknown[] = config?.plugins || [];

    const customPlugins: unknown[] = [];
    for (const plugin of plugins) {
      const name = typeof plugin === 'string' ? plugin : Array.isArray(plugin) ? plugin[0] : '';
      if (typeof name === 'string' && !isZtsNativePlugin(name)) {
        // Preserve plugin options: ['plugin-name', { opt: val }] or just 'plugin-name'
        if (Array.isArray(plugin)) {
          try {
            customPlugins.push([
              require.resolve(plugin[0] as string),
              ...(plugin.slice(1) as unknown[]),
            ]);
          } catch {
            customPlugins.push(plugin);
          }
        } else {
          try {
            customPlugins.push(require.resolve(name));
          } catch {
            customPlugins.push(name);
          }
        }
      }
    }

    babelOptions = {
      presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
      plugins: customPlugins,
      babelrc: false,
      configFile: false,
      compact: false,
      sourceMaps: false,
    };

    const pluginNames = customPlugins.map((p) =>
      Array.isArray(p) ? (p[0] as string).split('/').pop() : String(p).split('/').pop(),
    );
    process.stderr.write(`[bungae:babel] loaded: ${pluginNames.join(', ')}\n`);
  }

  return (code: string, filename: string): string | null => {
    try {
      ensureBabel();
      const result = babel.transformSync(code, {
        ...babelOptions,
        filename,
      });
      if (result?.code && result.code !== code) {
        process.stderr.write(
          `[bungae:babel] ${filename.split('/').pop()}: ${code.length} -> ${result.code.length}\n`,
        );
        return result.code;
      }
      return null;
    } catch (err: any) {
      process.stderr.write(`[bungae:babel] error: ${err.message?.slice(0, 100)}\n`);
      throw err;
    }
  };
}

// ===== RN Codegen Transformer (babel-plugin-codegen 래핑) =====

/**
 * `codegenNativeComponent<Props>('Name')` 호출을 static view config로 치환하는 워크어라운드.
 *
 * ZTS가 `@react-native/babel-preset`을 자체 처리하지만 그 안의 `@react-native/babel-plugin-codegen`은
 * 미구현. RN 0.85+ New Arch에서 Fabric이 `DebuggingOverlay` 등을 자동 등록하면서 JS view config 부재가
 * 크래시로 이어짐 (View config not found for component `DebuggingOverlay`). 이 워크어라운드로 해당
 * 플러그인만 Babel 파이프라인으로 실행해서 번들에 view config를 직접 박음.
 *
 * ZTS 네이티브 구현은 ohah/zts#1589 (Metro 호환성 meta) A-1 항목.
 */
export const CODEGEN_NATIVE_COMPONENT_MARKER = 'codegenNativeComponent';

/** .js/.ts 파일만 처리 (플러그인이 .jsx/.tsx 미지원) */
const CODEGEN_FILENAME_PATTERN = /\.(js|ts)$/;

export function createCodegenTransformer(
  projectRoot: string,
): (code: string, filename: string) => string | null {
  let babel: any = null;
  let codegenPlugin: any = null;
  let babelOptions: any = null;

  function ensureBabel() {
    if (babel) return;
    babel = require('@babel/core');

    // Resolve from projectRoot first, fall back to bungae's own location.
    // Bun의 deep-linked node_modules에서 일부 패키지가 workspace root에 symlink되지 않을 수 있음.
    try {
      const codegenPath = (() => {
        try {
          return require.resolve('@react-native/babel-plugin-codegen', {
            paths: [projectRoot, __dirname],
          });
        } catch {
          return require.resolve('@react-native/babel-plugin-codegen');
        }
      })();
      codegenPlugin = require(codegenPath);
    } catch (e: any) {
      process.stderr.write(
        `[bungae:codegen] @react-native/babel-plugin-codegen not found (${e.message?.slice(0, 80)}) — view config inlining disabled\n`,
      );
      throw e;
    }

    // Parser 플러그인은 파일 확장자에 따라 per-call로 결정 (아래 transform에서).
    // Flow/TS 타입 스트리핑은 ZTS가 후속 단계에서 처리하므로 preset 불필요.
    babelOptions = {
      babelrc: false,
      configFile: false,
      compact: false,
      sourceMaps: false,
      plugins: [codegenPlugin],
    };
  }

  return (code: string, filename: string): string | null => {
    if (!CODEGEN_FILENAME_PATTERN.test(filename)) return null;
    if (!code.includes(CODEGEN_NATIVE_COMPONENT_MARKER)) return null;

    // RN NativeComponent 파일은 확장자로 언어 구분:
    // - .js → Flow 제네릭(<T>)
    // - .ts → TypeScript 제네릭(<T>), interface, as 등
    // babel-plugin-codegen 내부 parseFile()도 같은 확장자 기준으로 분기.
    const parserPlugins = filename.endsWith('.ts') ? ['typescript'] : ['flow'];

    try {
      ensureBabel();
      const result = babel.transformSync(code, {
        ...babelOptions,
        filename,
        parserOpts: { plugins: parserPlugins },
      });
      if (result?.code && result.code !== code) {
        process.stderr.write(
          `[bungae:codegen] ${filename.split('/').pop()}: view config inlined\n`,
        );
        return result.code;
      }
      return null;
    } catch (err: any) {
      process.stderr.write(
        `[bungae:codegen] ${filename.split('/').pop()} failed: ${err.message?.slice(0, 120)}\n`,
      );
      return null;
    }
  };
}

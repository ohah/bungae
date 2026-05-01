/**
 * ZTS Plugin Core — HMR client + Babel transformer dispatch helpers.
 *
 * Asset 처리(AssetRegistry, registerAsset 코드 생성, scale variant 묶기)는
 * ZTS 코어가 직접 수행하므로 여기엔 없음 (napi-build.ts의 assetRegistry/loader/alias 옵션 참조).
 * 남은 함수들은 Node API(fs/require)에 의존해서 ZTS Zig로 옮길 수 없는 것들.
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

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
/** decorators plugin (legacy → ZTS `experimentalDecorators`). */
const DECORATORS_PLUGIN_PATTERNS = ['plugin-proposal-decorators', 'plugin-transform-decorators'];

/** root-import plugin (→ ZTS `alias`). */
const ROOT_IMPORT_PLUGIN_PATTERN = 'babel-plugin-root-import';

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
  // Bungae 가 babel.config 발견 시 ZTS 옵션으로 자동 매핑 (analyzeBabelPlugins).
  ...DECORATORS_PLUGIN_PATTERNS,
  ROOT_IMPORT_PLUGIN_PATTERN,
];

function isZtsNativePlugin(name: string): boolean {
  return ZTS_NATIVE_PLUGIN_PATTERNS.some((pattern) => name.includes(pattern));
}

/** Babel plugin entry (`'name'` 또는 `['name', opts]`) 에서 plugin 이름 추출. */
function extractBabelPluginName(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0];
  return '';
}

function matchesAny(name: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => name.includes(p));
}

/**
 * 사용자 babel.config 의 알려진 plugin 들을 ZTS 옵션으로 자동 매핑.
 * - decorators → ZTS `experimentalDecorators`
 * - root-import → ZTS `alias`
 * 그 외 allowlist 외 plugin 이 있으면 babel pass-through 필요 (`needsBabel=true`).
 */
export interface BabelPluginAnalysis {
  needsBabel: boolean;
  experimentalDecorators: boolean;
  rootImportAliases: Record<string, string>;
}

interface RootImportEntry {
  rootPathPrefix?: string;
  rootPathSuffix?: string;
}

interface RootImportOpts extends RootImportEntry {
  paths?: RootImportEntry[];
}

interface DecoratorOpts {
  version?: string;
}

export function analyzeBabelPlugins(projectRoot: string): BabelPluginAnalysis {
  const result: BabelPluginAnalysis = {
    needsBabel: false,
    experimentalDecorators: false,
    rootImportAliases: {},
  };
  try {
    const configPath = join(projectRoot, 'babel.config.js');
    if (!existsSync(configPath)) return result;
    const config = require(configPath);
    const plugins: unknown[] = config?.plugins || [];

    for (const entry of plugins) {
      const name = extractBabelPluginName(entry);
      if (!name) continue;
      const opts = Array.isArray(entry) ? entry[1] : undefined;

      if (matchesAny(name, DECORATORS_PLUGIN_PATTERNS)) {
        // legacy 만 자동 매핑 — ZTS `experimental_decorators` 와 동등. Stage 3
        // (`version: '2022-03'`) 는 별도 ZTS opt (`esDecorator`) — 현재는 babel forward.
        const version = (opts as DecoratorOpts | undefined)?.version;
        if (version === undefined || version === 'legacy') {
          result.experimentalDecorators = true;
          continue;
        }
      }

      if (name.includes(ROOT_IMPORT_PLUGIN_PATTERN)) {
        Object.assign(
          result.rootImportAliases,
          collectRootImportAliases(projectRoot, opts as RootImportOpts | undefined),
        );
        continue;
      }

      if (!isZtsNativePlugin(name)) result.needsBabel = true;
    }

    return result;
  } catch {
    return result;
  }
}

function collectRootImportAliases(
  projectRoot: string,
  opts: RootImportOpts | undefined,
): Record<string, string> {
  // root-import 두 형태 — 단일 (`{rootPathPrefix, rootPathSuffix}`) 또는 다중 (`{paths: [...]}`).
  const entries: RootImportEntry[] = opts?.paths ?? [
    { rootPathPrefix: opts?.rootPathPrefix, rootPathSuffix: opts?.rootPathSuffix },
  ];
  const aliases: Record<string, string> = {};
  for (const e of entries) {
    const prefix = e.rootPathPrefix ?? '~/';
    const suffix = e.rootPathSuffix ?? '.';
    // ZTS alias 는 trailing slash 없는 prefix → 절대 경로. `~/` → `~`.
    const aliasKey = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    aliases[aliasKey] = join(projectRoot, suffix);
  }
  return aliases;
}

/**
 * @deprecated `analyzeBabelPlugins` 사용. 호환성 유지를 위해 남김.
 */
export function detectCustomPlugins(projectRoot: string): boolean {
  return analyzeBabelPlugins(projectRoot).needsBabel;
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
      const name = extractBabelPluginName(plugin);
      if (name && !isZtsNativePlugin(name)) {
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
 * 파일만 `@react-native/codegen`으로 schema화해서 번들에 view config를 직접 박음.
 *
 * ZTS 네이티브 구현은 ohah/zts#1589 (Metro 호환성 meta) A-1 항목.
 */
export const CODEGEN_NATIVE_COMPONENT_MARKER = 'codegenNativeComponent';

/** .js/.ts 파일만 처리 (플러그인이 .jsx/.tsx 미지원) */
const CODEGEN_FILENAME_PATTERN = /\.(js|ts)$/;
const CODEGEN_EXPORT_PATTERN = /export\s+default[\s\S]*?\bcodegenNativeComponent\s*(?:<|\()/;

export function createCodegenTransformer(
  projectRoot: string,
): (code: string, filename: string) => string | null {
  let flowParser: any = null;
  let typeScriptParser: any = null;
  let rnCodegen: any = null;

  // Diagnostic timer (BUNGAE_CODEGEN_PROFILE=1 to enable per-file logs)
  const profile = process.env.BUNGAE_CODEGEN_PROFILE === '1';
  let totalMs = 0;
  let inlinedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const flush = () => {
    process.stderr.write(
      `[bungae:codegen] total=${totalMs.toFixed(1)}ms (inlined=${inlinedCount}, failed=${failedCount}, no-op=${skippedCount})\n`,
    );
  };
  // print summary on exit
  process.once('beforeExit', flush);
  process.once('SIGINT', () => {
    flush();
    process.exit(130);
  });

  let codegenResolvePaths: string[] | null = null;
  function getCodegenResolvePaths() {
    if (codegenResolvePaths) return codegenResolvePaths;

    codegenResolvePaths = [projectRoot, __dirname];
    try {
      const reactNativePackage = require.resolve('react-native/package.json', {
        paths: [projectRoot, __dirname],
      });
      codegenResolvePaths.push(dirname(reactNativePackage));
    } catch {
      // React Native is optional for non-RN projects; the direct codegen require below will report.
    }
    return codegenResolvePaths;
  }

  function requireCodegenModule(srcPath: string, libPath: string) {
    for (const request of [srcPath, libPath]) {
      try {
        return require(require.resolve(request, { paths: getCodegenResolvePaths() }));
      } catch {}
    }

    try {
      return require(srcPath);
    } catch {
      return require(libPath);
    }
  }

  function ensureCodegen() {
    if (rnCodegen) return;

    try {
      const FlowParser = requireCodegenModule(
        '@react-native/codegen/src/parsers/flow/parser',
        '@react-native/codegen/lib/parsers/flow/parser',
      ).FlowParser;
      const TypeScriptParser = requireCodegenModule(
        '@react-native/codegen/src/parsers/typescript/parser',
        '@react-native/codegen/lib/parsers/typescript/parser',
      ).TypeScriptParser;

      flowParser = new FlowParser();
      typeScriptParser = new TypeScriptParser();
      rnCodegen = requireCodegenModule(
        '@react-native/codegen/src/generators/RNCodegen',
        '@react-native/codegen/lib/generators/RNCodegen',
      );
    } catch (e: any) {
      process.stderr.write(
        `[bungae:codegen] @react-native/codegen not found (${e.message?.slice(0, 80)}) — view config inlining disabled\n`,
      );
      throw e;
    }
  }

  function generateViewConfig(code: string, filename: string): string {
    ensureCodegen();

    const schema = filename.endsWith('.ts')
      ? typeScriptParser.parseString(code)
      : flowParser.parseString(code);
    const libraryName = basename(filename).replace(/NativeComponent\.(js|ts)$/, '');

    return rnCodegen.generateViewConfig({
      libraryName,
      schema,
    });
  }

  return (code: string, filename: string): string | null => {
    if (!CODEGEN_FILENAME_PATTERN.test(filename)) return null;
    if (filename.endsWith('.d.ts')) return null;
    if (!code.includes(CODEGEN_NATIVE_COMPONENT_MARKER)) return null;
    if (!CODEGEN_EXPORT_PATTERN.test(code)) return null;

    const t0 = performance.now();
    try {
      const result = generateViewConfig(code, filename);
      const dt = performance.now() - t0;
      totalMs += dt;
      if (result && result.includes('__INTERNAL_VIEW_CONFIG')) {
        inlinedCount++;
        if (profile) {
          process.stderr.write(
            `[bungae:codegen] ${filename.split('/').pop()}: view config inlined (${dt.toFixed(1)}ms)\n`,
          );
        } else {
          process.stderr.write(
            `[bungae:codegen] ${filename.split('/').pop()}: view config inlined\n`,
          );
        }
        return result;
      }
      skippedCount++;
      return null;
    } catch (err: any) {
      totalMs += performance.now() - t0;
      failedCount++;
      process.stderr.write(
        `[bungae:codegen] ${filename.split('/').pop()} failed: ${err.message?.slice(0, 120)}\n`,
      );
      return null;
    }
  };
}

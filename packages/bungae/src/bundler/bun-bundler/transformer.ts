/**
 * Code transformation for Bun Bundler
 *
 * Pipeline (Hermes Parser + Babel):
 * - JavaScript/Flow: babel-plugin-syntax-hermes-parser → @babel/plugin-transform-flow-strip-types
 * - TypeScript: @babel/plugin-transform-typescript
 *
 * Hermes Parser 사용 이점:
 * - React 19 `component` 키워드 지원 (reactRuntimeTarget: '19')
 * - Flow 구문 네이티브 파싱
 * - Babel parser보다 빠름
 *
 * 참고: 롤리팝과 동일한 접근법
 */

import { extname } from 'path';

import type { File as BabelAST } from '@babel/types';

import type { ResolvedConfig } from '../../config/types';

// ============================================================================
// 모듈 캐싱 (동적 import 오버헤드 제거)
// ============================================================================
let cachedBabel: typeof import('@babel/core') | null = null;

async function getBabel() {
  if (!cachedBabel) {
    cachedBabel = await import('@babel/core');
  }
  return cachedBabel;
}

/**
 * Transform a single file
 */
export async function transformFile(
  filePath: string,
  code: string,
  config: ResolvedConfig,
  entryPath?: string,
): Promise<{ ast: BabelAST } | null> {
  const { platform, dev } = config;

  // Skip Flow definition files
  if (filePath.endsWith('.flow.js') || filePath.endsWith('.flow')) {
    return null;
  }

  // JSON files: Export as module
  const isJSON = filePath.endsWith('.json');
  if (isJSON) {
    const babel = await getBabel();
    const ast = await babel.parseAsync(`module.exports = ${code};`, {
      filename: filePath,
      sourceType: 'module',
    });
    if (!ast) return null;
    return { ast };
  }

  return transformWithHermesParser(code, filePath, {
    dev,
    platform,
    root: config.root,
    entryPath,
  });
}

/**
 * Transform code using Hermes Parser + Babel
 *
 * 파이프라인 (롤리팝 스타일):
 * - JavaScript/Flow: babel-plugin-syntax-hermes-parser (Hermes로 파싱) → Flow 타입 제거
 * - TypeScript: @babel/plugin-transform-typescript
 *
 * Hermes Parser 이점:
 * - React 19 `component` 키워드 네이티브 지원
 * - Flow 구문 완벽 파싱
 * - 빠른 파싱 속도
 */
export async function transformWithHermesParser(
  code: string,
  filePath: string,
  options: { dev: boolean; platform: string; root: string; entryPath?: string },
): Promise<{ ast: BabelAST }> {
  const babel = await getBabel();

  const OLD_BABEL_ENV = process.env.BABEL_ENV;
  process.env.BABEL_ENV = options.dev ? 'development' : process.env.BABEL_ENV || 'production';

  try {
    const fileExt = extname(filePath).toLowerCase();
    const isTypeScript = fileExt === '.ts' || fileExt === '.tsx';
    const isJSX = fileExt === '.jsx' || fileExt === '.tsx';

    // ========================================================================
    // 파일 타입별 플러그인 설정
    // ========================================================================
    const plugins: any[] = [
      // 공통 플러그인
      [
        require.resolve('babel-plugin-transform-define'),
        {
          __DEV__: options.dev,
          'Platform.OS': options.platform,
          'process.env.NODE_ENV': JSON.stringify(options.dev ? 'development' : 'production'),
        },
      ],
      [
        require.resolve('@babel/plugin-transform-object-rest-spread'),
        {
          loose: true,
          useBuiltIns: true,
        },
      ],
      // ESM → CommonJS 변환 (React Native는 CommonJS 사용)
      [
        require.resolve('@babel/plugin-transform-modules-commonjs'),
        {
          strict: false,
          strictMode: false,
          allowTopLevelThis: true,
          lazy: false,
        },
      ],
    ];

    // Production 전용 플러그인
    if (!options.dev) {
      plugins.push(require.resolve('babel-plugin-minify-simplify'), [
        require.resolve('babel-plugin-minify-dead-code-elimination'),
        { keepFnName: true },
      ]);
    }

    // 파일 타입별 플러그인
    if (isTypeScript) {
      // TypeScript: @babel/plugin-transform-typescript (JSX 포함)
      plugins.unshift([
        require.resolve('@babel/plugin-transform-typescript'),
        {
          isTSX: isJSX,
          allowNamespaces: true,
        },
      ]);
      // TypeScript JSX 변환
      if (isJSX) {
        plugins.push([
          require.resolve('@babel/plugin-transform-react-jsx'),
          {
            runtime: 'automatic',
          },
        ]);
      }
    } else {
      // JavaScript/Flow: Hermes Parser + Flow 타입 제거
      plugins.unshift(
        [
          require.resolve('babel-plugin-syntax-hermes-parser'),
          {
            parseLangTypes: 'flow',
            reactRuntimeTarget: '19', // React 19 component 키워드 지원
          },
        ],
        require.resolve('@babel/plugin-transform-flow-strip-types'),
      );
      // JavaScript JSX 변환
      if (isJSX || fileExt === '.js') {
        plugins.push([
          require.resolve('@babel/plugin-transform-react-jsx'),
          {
            runtime: 'automatic',
          },
        ]);
      }
    }

    // ========================================================================
    // Babel 변환 실행
    // ========================================================================
    const babelConfig: any = {
      ast: true,
      babelrc: false, // 외부 babel 설정 무시 (parser 충돌 방지)
      configFile: false, // babel.config.js 무시
      caller: {
        bundler: 'metro',
        name: 'metro',
        platform: options.platform,
      },
      cloneInputAst: false,
      code: false,
      cwd: options.root,
      filename: filePath,
      highlightCode: true,
      sourceType: 'module',
      presets: [
        // ES6 class → ES5 function 변환만 수행 (호이스팅 문제 해결)
        [
          require.resolve('@babel/preset-env'),
          {
            targets: { esmodules: true }, // 최신 브라우저 타겟 (최소 변환)
            modules: false,
            useBuiltIns: false,
            // classes 변환만 포함 (가장 빠른 설정)
            include: ['@babel/plugin-transform-classes'],
          },
        ],
      ],
      plugins,
    };

    const transformResult = await babel.transformAsync(code, babelConfig);

    if (!transformResult?.ast) {
      const emptyProgram = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'module' },
                property: { type: 'Identifier', name: 'exports' },
              },
              right: { type: 'ObjectExpression', properties: [] },
            },
          },
        ],
        directives: [],
        sourceType: 'module',
      };
      const emptyAst = {
        type: 'File',
        program: emptyProgram,
        comments: [],
        tokens: [],
      };
      return { ast: emptyAst as BabelAST };
    }

    return { ast: transformResult.ast };
  } finally {
    if (OLD_BABEL_ENV) {
      process.env.BABEL_ENV = OLD_BABEL_ENV;
    }
  }
}

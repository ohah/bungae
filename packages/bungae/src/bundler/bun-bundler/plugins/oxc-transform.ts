/**
 * Bun Plugin: OXC Transform
 *
 * OXC(Oxidation Compiler)를 사용하여 ES2015로 변환합니다.
 * - Private fields (#field) → WeakMap 기반 코드
 * - Class properties 변환
 * - JSX 변환
 *
 * OXC는 Babel보다 20-50배, SWC보다 3-5배 빠릅니다.
 */

import type { BunPlugin } from 'bun';
import { transformSync } from 'oxc-transform';

export interface OxcTransformPluginOptions {
  /** 개발 모드 */
  dev?: boolean;
  /** 타겟 (기본: es2015) */
  target?: string[];
  /** JSX 런타임 (기본: automatic) */
  jsxRuntime?: 'automatic' | 'classic';
  /** JSX import source (기본: react) */
  jsxImportSource?: string;
}

/**
 * OXC Transform Bun 플러그인
 *
 * 모든 JS/JSX 파일을 ES2015로 변환하여 Hermes 호환성을 보장합니다.
 */
export function oxcTransformPlugin(options: OxcTransformPluginOptions = {}): BunPlugin {
  const {
    dev = true,
    target = ['es2015'],
    jsxRuntime = 'automatic',
    jsxImportSource = 'react',
  } = options;

  return {
    name: 'oxc-transform',
    setup(build) {
      // 모든 JS/JSX 파일 처리
      build.onLoad({ filter: /\.(js|jsx)$/ }, async (args) => {
        const code = await Bun.file(args.path).text();

        try {
          const result = transformSync(args.path, code, {
            target,
            jsx: {
              runtime: jsxRuntime,
              importSource: jsxImportSource,
              development: dev,
            },
            // ES2015 호환을 위한 설정
            assumptions: {
              setPublicClassFields: true,
            },
          });

          // 에러가 있으면 로그
          if (result.errors && result.errors.length > 0) {
            const hasError = result.errors.some((e) => e.severity === 'Error');
            if (hasError) {
              console.error(`OXC transform errors for ${args.path}:`, result.errors);
              return undefined; // Bun 기본 처리로 폴백
            }
          }

          return {
            contents: result.code,
            loader: 'js',
          };
        } catch (error) {
          console.error(`OXC transform failed for ${args.path}:`, error);
          return undefined;
        }
      });

      // TypeScript 파일도 처리
      build.onLoad({ filter: /\.(ts|tsx)$/ }, async (args) => {
        const code = await Bun.file(args.path).text();

        try {
          const result = transformSync(args.path, code, {
            target,
            jsx: args.path.endsWith('.tsx')
              ? {
                  runtime: jsxRuntime,
                  importSource: jsxImportSource,
                  development: dev,
                }
              : undefined,
            typescript: {
              onlyRemoveTypeImports: false,
            },
            assumptions: {
              setPublicClassFields: true,
            },
          });

          if (result.errors && result.errors.length > 0) {
            const hasError = result.errors.some((e) => e.severity === 'Error');
            if (hasError) {
              console.error(`OXC transform errors for ${args.path}:`, result.errors);
              return undefined;
            }
          }

          return {
            contents: result.code,
            loader: 'js',
          };
        } catch (error) {
          console.error(`OXC transform failed for ${args.path}:`, error);
          return undefined;
        }
      });
    },
  };
}

/**
 * 단일 파일 변환 함수 (직접 사용 가능)
 */
export function transformWithOxc(
  filePath: string,
  code: string,
  options: OxcTransformPluginOptions = {},
): string {
  const {
    dev = true,
    target = ['es2015'],
    jsxRuntime = 'automatic',
    jsxImportSource = 'react',
  } = options;

  const isJsx = filePath.endsWith('.jsx') || filePath.endsWith('.tsx');
  const isTs = filePath.endsWith('.ts') || filePath.endsWith('.tsx');

  const result = transformSync(filePath, code, {
    target,
    jsx: isJsx
      ? {
          runtime: jsxRuntime,
          importSource: jsxImportSource,
          development: dev,
        }
      : undefined,
    typescript: isTs
      ? {
          onlyRemoveTypeImports: false,
        }
      : undefined,
    assumptions: {
      setPublicClassFields: true,
    },
  });

  return result.code;
}

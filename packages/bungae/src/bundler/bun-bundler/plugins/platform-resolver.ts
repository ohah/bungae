/**
 * Bun Plugin: Platform-specific module resolution
 *
 * React Native 플랫폼별 확장자를 처리합니다:
 * - .ios.js, .ios.tsx 등 (iOS)
 * - .android.js, .android.tsx 등 (Android)
 * - .native.js, .native.tsx 등 (공통 네이티브)
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import type { BunPlugin } from 'bun';

export interface PlatformResolverPluginOptions {
  platform: 'ios' | 'android';
  /** 프로젝트 루트 경로 */
  root: string;
  /** node_modules 검색 경로 */
  nodeModulesPaths?: string[];
  /** 지원하는 확장자 (기본값 포함) */
  extensions?: string[];
}

const DEFAULT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.json'];

/**
 * 플랫폼별 확장자 우선순위 생성
 * 예: platform=ios → ['.ios.tsx', '.ios.ts', '.native.tsx', '.native.ts', '.tsx', '.ts', ...]
 */
function getPlatformExtensions(platform: string, baseExtensions: string[]): string[] {
  const platformExts: string[] = [];

  for (const ext of baseExtensions) {
    // 플랫폼 특화 확장자
    platformExts.push(`.${platform}${ext}`);
  }

  for (const ext of baseExtensions) {
    // 네이티브 공통 확장자
    platformExts.push(`.native${ext}`);
  }

  // 기본 확장자
  platformExts.push(...baseExtensions);

  return platformExts;
}

/**
 * 모듈 경로 해석
 */
function resolveModulePath(
  specifier: string,
  importer: string,
  options: PlatformResolverPluginOptions,
): string | null {
  const { platform, root, nodeModulesPaths = [], extensions = DEFAULT_EXTENSIONS } = options;
  const platformExts = getPlatformExtensions(platform, extensions);

  // 상대 경로 처리
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const baseDir = importer ? dirname(importer) : root;
    const basePath = resolve(baseDir, specifier);

    // 이미 확장자가 있는 경우
    if (extensions.some((ext) => specifier.endsWith(ext))) {
      // 플랫폼 확장자로 교체 시도
      for (const ext of extensions) {
        if (specifier.endsWith(ext)) {
          const withoutExt = basePath.slice(0, -ext.length);
          for (const platformExt of platformExts) {
            const candidate = withoutExt + platformExt;
            if (existsSync(candidate)) {
              return candidate;
            }
          }
          break;
        }
      }
      // 원본 경로 반환
      if (existsSync(basePath)) {
        return basePath;
      }
    }

    // 확장자 없는 경우 - 플랫폼 확장자 순서대로 시도
    for (const ext of platformExts) {
      const candidate = basePath + ext;
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    // 디렉토리인 경우 index 파일 시도
    for (const ext of platformExts) {
      const candidate = join(basePath, `index${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  // 패키지 모듈 처리 (node_modules)
  const searchPaths = [root, ...nodeModulesPaths];

  for (const searchPath of searchPaths) {
    const nodeModulesPath = join(searchPath, 'node_modules', specifier);

    // 직접 파일 경로
    for (const ext of platformExts) {
      const candidate = nodeModulesPath + ext;
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    // package.json의 main/module 필드 확인
    const pkgJsonPath = join(nodeModulesPath, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const mainField = pkgJson.main || pkgJson.module || 'index.js';
        const mainPath = join(nodeModulesPath, mainField);

        // main 필드의 플랫폼 변형 확인
        for (const ext of extensions) {
          if (mainPath.endsWith(ext)) {
            const withoutExt = mainPath.slice(0, -ext.length);
            for (const platformExt of platformExts) {
              const candidate = withoutExt + platformExt;
              if (existsSync(candidate)) {
                return candidate;
              }
            }
            break;
          }
        }

        if (existsSync(mainPath)) {
          return mainPath;
        }
      } catch {
        // package.json 파싱 실패 무시
      }
    }

    // index 파일 시도
    for (const ext of platformExts) {
      const candidate = join(nodeModulesPath, `index${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * 플랫폼별 모듈 해석 Bun 플러그인
 *
 * 플랫폼 확장자(.ios.js, .android.js, .native.js)가 있는 파일만 처리하고,
 * 나머지는 Bun 기본 해석기에 위임합니다.
 */
export function platformResolverPlugin(options: PlatformResolverPluginOptions): BunPlugin {
  const { platform, extensions = DEFAULT_EXTENSIONS } = options;

  return {
    name: 'platform-resolver',
    setup(build) {
      // 상대 경로 import만 처리 (./foo, ../bar)
      // node_modules는 Bun 기본 해석기에 위임
      build.onResolve({ filter: /^\.\.?\/.*/ }, (args) => {
        // importer가 없으면 entry point이므로 건너뛰기
        if (!args.importer) {
          return undefined;
        }

        const baseDir = dirname(args.importer);
        const basePath = resolve(baseDir, args.path);

        // 플랫폼 확장자 파일 확인 (.ios.js, .native.js 등)
        for (const ext of extensions) {
          // 플랫폼 특화 파일 확인
          const platformPath = `${basePath}.${platform}${ext}`;
          if (existsSync(platformPath)) {
            return { path: platformPath };
          }

          // 네이티브 공통 파일 확인
          const nativePath = `${basePath}.native${ext}`;
          if (existsSync(nativePath)) {
            return { path: nativePath };
          }
        }

        // 플랫폼 파일이 없으면 Bun 기본 해석기 사용
        return undefined;
      });
    },
  };
}

export { getPlatformExtensions, resolveModulePath };

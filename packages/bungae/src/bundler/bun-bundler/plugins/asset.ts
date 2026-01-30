/**
 * Bun Plugin: Metro-compatible asset handling
 *
 * require('./image.png') 등을 AssetRegistry.registerAsset() 형태의 JS 모듈로 변환합니다.
 * React Native / Metro와 동일한 에셋 등록 형식을 사용합니다.
 */

import type { BunPlugin } from 'bun';

import { generateAssetModuleCode, getImageSize } from '../utils';

/** Collected asset path + size (avoids re-reading file in assetPathsToAssetInfos) */
export interface CollectedAsset {
  path: string;
  width: number;
  height: number;
}

export interface AssetPluginOptions {
  /** 프로젝트 루트 (httpServerLocation 계산용) */
  root: string;
  /** 에셋 확장자 (예: ['.png', '.jpg']) - dot 포함 */
  assetExts: string[];
  /** 빌드 시 로드된 에셋 경로·크기 수집 (build 결과의 assets 생성용) */
  collectedAssets: CollectedAsset[];
}

/**
 * 에셋 확장자로 filter 정규식 생성
 * assetExts가 ['.png', '.jpg']일 때 /\.(png|jpg)$/ 형태
 * assetExts가 빈 배열이면 아무것도 매칭하지 않음 (resolver.assetExts: []와 일치)
 */
function assetFilterRegex(assetExts?: string[]): RegExp {
  if (assetExts == null) {
    return /\.(png|jpg|jpeg|gif|bmp|webp|avif|ico|icns|icxl)$/;
  }
  const exts = assetExts.map((ext) => ext.replace(/^\./, '')).filter(Boolean);
  if (exts.length === 0) {
    return /$a/; // matches nothing; respects resolver.assetExts: []
  }
  const pattern = exts.join('|');
  return new RegExp(`\\.(${pattern})$`);
}

/**
 * Metro 호환 에셋 로더 플러그인
 * 에셋 파일을 만나면 JS 모듈(registerAsset 코드)로 변환하고 경로를 수집합니다.
 */
export function assetPlugin(options: AssetPluginOptions): BunPlugin {
  const { root, assetExts, collectedAssets } = options;
  const filter = assetFilterRegex(assetExts);

  return {
    name: 'bungae-asset',
    setup(build) {
      build.onLoad({ filter }, (args) => {
        const path = args.path;
        const { width, height } = getImageSize(path);
        collectedAssets.push({ path, width, height });
        const contents = generateAssetModuleCode(path, root, { width, height });
        return {
          loader: 'js',
          contents,
        };
      });
    },
  };
}

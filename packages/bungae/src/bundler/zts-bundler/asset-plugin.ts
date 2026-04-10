/**
 * ZTS Asset Plugin for React Native
 *
 * Metro 호환 에셋 처리: require('./image.png') → AssetRegistry.registerAsset({...})
 * ZTS subprocess plugin으로 실행 — 환경변수로 설정을 전달받는다.
 *
 * 환경변수:
 *   ZTS_ASSET_EXTS     — 에셋 확장자 목록 (쉼표 구분, 예: ".png,.jpg,.gif")
 *   ZTS_PROJECT_ROOT   — 프로젝트 루트 (httpServerLocation 계산용)
 */

import { extname } from 'node:path';
import { createInterface } from 'node:readline';

import {
  ASSET_EXTS_DEFAULT,
  ASSET_REGISTRY_CODE,
  ZTS_HMR_CLIENT_CODE,
  ASSET_REGISTRY_SPECIFIERS,
  HMR_CLIENT_SUFFIX,
  generateAssetCode,
  computeHttpServerLocation,
} from './plugin-core';

export { computeHttpServerLocation };

// ===== 환경변수에서 설정 읽기 =====

const ASSET_EXTS: string[] = process.env.ZTS_ASSET_EXTS
  ? process.env.ZTS_ASSET_EXTS.split(',')
      .map((e) => e.trim())
      .filter(Boolean)
  : ASSET_EXTS_DEFAULT;

const PROJECT_ROOT = process.env.ZTS_PROJECT_ROOT ?? process.cwd();
const RN_PLATFORM = process.env.ZTS_RN_PLATFORM ?? 'ios';

// AssetRegistry 가상 모듈 ID
const VIRTUAL_ASSET_REGISTRY = '\0bungae:asset-registry';
// HMRClient 교체 (롤리팝 방식: onLoad hook으로 Metro HMRClient를 ZTS HMR 클라이언트로 교체)
const VIRTUAL_HMR_CLIENT = '\0bungae:hmr-client';

// ===== ZTS IPC 프로토콜 =====

interface IpcMessage {
  id: number;
  type: string;
  path?: string;
  specifier?: string;
  importer?: string;
  code?: string;
  moduleId?: string;
}

function isAssetFile(filePath: string): boolean {
  return ASSET_EXTS.includes(extname(filePath).toLowerCase());
}

function handleMessage(msg: IpcMessage): string {
  switch (msg.type) {
    case 'init':
      return JSON.stringify({
        id: msg.id,
        name: 'bungae:react-native-asset',
        filters: {
          resolveId: ASSET_REGISTRY_SPECIFIERS,
          load: [...ASSET_EXTS, VIRTUAL_ASSET_REGISTRY, VIRTUAL_HMR_CLIENT, HMR_CLIENT_SUFFIX],
        },
        hooks: {
          resolveId: true,
          load: true,
          transform: false,
          renderChunk: false,
          generateBundle: false,
        },
        config: {},
        error: null,
      });

    case 'resolveId': {
      // react-native/Libraries/Image/AssetRegistry 또는 @react-native/assets-registry/registry
      // → 같은 가상 모듈로 리다이렉트 (단일 assets 배열 공유)
      if (msg.specifier && ASSET_REGISTRY_SPECIFIERS.includes(msg.specifier)) {
        return JSON.stringify({
          id: msg.id,
          result: { path: VIRTUAL_ASSET_REGISTRY },
          error: null,
        });
      }
      return JSON.stringify({ id: msg.id, result: null, error: null });
    }

    case 'load': {
      // 가상 AssetRegistry 모듈
      if (msg.path === VIRTUAL_ASSET_REGISTRY) {
        return JSON.stringify({
          id: msg.id,
          result: { contents: ASSET_REGISTRY_CODE },
          error: null,
        });
      }
      // HMRClient.js → ZTS HMR 클라이언트로 교체 (롤리팝 방식: onLoad intercept)
      if (msg.path && msg.path.endsWith(HMR_CLIENT_SUFFIX)) {
        return JSON.stringify({
          id: msg.id,
          result: { contents: ZTS_HMR_CLIENT_CODE },
          error: null,
        });
      }
      // 에셋 파일
      const filePath = msg.path;
      if (!filePath || !isAssetFile(filePath)) {
        return JSON.stringify({ id: msg.id, result: null, error: null });
      }
      try {
        const code = generateAssetCode(filePath, {
          projectRoot: PROJECT_ROOT,
          platform: RN_PLATFORM,
        });
        return JSON.stringify({ id: msg.id, result: { contents: code }, error: null });
      } catch (err) {
        return JSON.stringify({
          id: msg.id,
          result: null,
          error: `[bungae:react-native-asset] ${err}`,
        });
      }
    }

    case 'shutdown':
      process.exit(0);

    default:
      return JSON.stringify({ id: msg.id, result: null, error: null });
  }
}

// ===== IPC 루프 =====

const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

rl.on('line', (line) => {
  try {
    const msg: IpcMessage = JSON.parse(line);
    process.stdout.write(handleMessage(msg) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ id: 0, result: null, error: String(err) }) + '\n');
  }
});

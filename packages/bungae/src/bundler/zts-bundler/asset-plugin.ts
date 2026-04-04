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

import { openSync, readSync, readFileSync, readdirSync, closeSync } from 'node:fs';
import { basename, dirname, extname, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

// ===== 환경변수에서 설정 읽기 =====

const ASSET_EXTS: string[] = process.env.ZTS_ASSET_EXTS
  ? process.env.ZTS_ASSET_EXTS.split(',').map((e) => e.trim()).filter(Boolean)
  : [
      '.bmp', '.gif', '.jpg', '.jpeg', '.png', '.psd', '.svg', '.webp',
      '.tiff', '.tif', '.xml', '.avif', '.ico',
      '.m4v', '.mov', '.mp4', '.mpeg', '.mpg', '.webm',
      '.aac', '.aiff', '.caf', '.m4a', '.mp3', '.wav',
      '.html', '.pdf', '.yaml', '.yml',
      '.otf', '.ttf', '.woff', '.woff2',
    ];

const PROJECT_ROOT = process.env.ZTS_PROJECT_ROOT ?? process.cwd();

// AssetRegistry 가상 모듈 ID
const VIRTUAL_ASSET_REGISTRY = '\0bungae:asset-registry';
const ASSET_REGISTRY_SPECIFIER = 'react-native/Libraries/Image/AssetRegistry';

// ===== 이미지 치수 추출 =====
// TODO: graph-bundler/utils.ts의 getImageSize와 중복 — 공용 유틸로 추출 필요

function getImageSizeFromBuffer(buffer: Buffer, ext: string): { width: number; height: number } {
  if (ext === '.png') {
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
  } else if (ext === '.jpg' || ext === '.jpeg') {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1]!;
      if (marker === 0xc0 || marker === 0xc2) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  } else if (ext === '.gif') {
    if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
  }
  return { width: 0, height: 0 };
}

function readImageDimensions(filePath: string, ext: string): { width: number; height: number } {
  try {
    if (ext === '.png' || ext === '.gif') {
      const buf = Buffer.alloc(24);
      const fd = openSync(filePath, 'r');
      try { readSync(fd, buf, 0, 24, 0); } finally { closeSync(fd); }
      return getImageSizeFromBuffer(buf, ext);
    }
    return getImageSizeFromBuffer(readFileSync(filePath), ext);
  } catch {
    return { width: 0, height: 0 };
  }
}

// ===== 스케일 변형 탐색 =====

const SCALE_REGEX = /@(\d+(?:\.\d+)?)x/;
const dirCache = new Map<string, string[]>();

function cachedReaddirSync(dir: string): string[] {
  let entries = dirCache.get(dir);
  if (!entries) {
    entries = readdirSync(dir);
    dirCache.set(dir, entries);
  }
  return entries;
}

function findScales(filePath: string): number[] {
  const ext = extname(filePath);
  const dir = dirname(filePath);
  const nameWithoutExt = basename(filePath, ext);

  try {
    const files = cachedReaddirSync(dir);
    const scales = new Set<number>([1]);
    const pattern = new RegExp(`^${escapeRegex(nameWithoutExt)}${SCALE_REGEX.source}$`);

    for (const file of files) {
      if (!file.endsWith(ext)) continue;
      const match = basename(file, ext).match(pattern);
      if (match?.[1]) {
        scales.add(parseFloat(match[1]));
      }
    }

    return Array.from(scales).sort((a, b) => a - b);
  } catch {
    return [1];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===== Metro 호환 에셋 코드 생성 =====

function generateAssetCode(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath, extname(filePath));
  const type = extname(filePath).slice(1);
  const relativePath = relative(PROJECT_ROOT, dirname(filePath)).replace(/\\/g, '/');
  const httpServerLocation =
    relativePath && relativePath !== '.' ? `/assets/${relativePath}` : '/assets';
  const scales = findScales(filePath);

  const { width, height } = readImageDimensions(filePath, ext);
  const hash = createHash('md5').update(readFileSync(filePath)).digest('hex').slice(0, 16);

  const assetData = JSON.stringify({ __packager_asset: true, httpServerLocation, width, height, scales, hash, name, type });

  return [
    `var _registry = require("${ASSET_REGISTRY_SPECIFIER}");`,
    `module.exports = _registry.registerAsset(${assetData});`,
  ].join('\n');
}

// AssetRegistry 인라인 구현 — @react-native/assets-registry 패키지가
// 설치되지 않은 환경에서도 동작. RN AssetRegistry.js가 ESM re-export로
// 깨지는 문제를 우회한다.
const ASSET_REGISTRY_CODE = `
var assets = [];
function registerAsset(asset) {
  return assets.push(asset);
}
function getAssetByID(assetId) {
  return assets[assetId - 1];
}
module.exports = { registerAsset: registerAsset, getAssetByID: getAssetByID };
`;

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
        filters: { resolveId: [ASSET_REGISTRY_SPECIFIER], load: [...ASSET_EXTS, VIRTUAL_ASSET_REGISTRY] },
        hooks: { resolveId: true, load: true, transform: false, renderChunk: false, generateBundle: false },
        config: {},
        error: null,
      });

    case 'resolveId': {
      // react-native/Libraries/Image/AssetRegistry → 가상 모듈로 리다이렉트
      if (msg.specifier === ASSET_REGISTRY_SPECIFIER) {
        return JSON.stringify({ id: msg.id, result: { path: VIRTUAL_ASSET_REGISTRY }, error: null });
      }
      return JSON.stringify({ id: msg.id, result: null, error: null });
    }

    case 'load': {
      // 가상 AssetRegistry 모듈
      if (msg.path === VIRTUAL_ASSET_REGISTRY) {
        return JSON.stringify({ id: msg.id, result: { contents: ASSET_REGISTRY_CODE }, error: null });
      }
      // 에셋 파일
      const filePath = msg.path;
      if (!filePath || !isAssetFile(filePath)) {
        return JSON.stringify({ id: msg.id, result: null, error: null });
      }
      try {
        const code = generateAssetCode(filePath);
        return JSON.stringify({ id: msg.id, result: { contents: code }, error: null });
      } catch (err) {
        return JSON.stringify({ id: msg.id, result: null, error: `[bungae:react-native-asset] ${err}` });
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

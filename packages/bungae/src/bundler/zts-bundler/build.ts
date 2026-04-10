/**
 * ZTS one-shot build
 */

import { mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname, extname, basename, relative } from 'path';

import type { ResolvedConfig } from '../../config/types';
import type { BuildResult } from '../graph-bundler';
import { logInfo, logWarn } from '../graph-bundler/utils';
import { buildWithNapi } from './napi-build';

const SCALE_REGEX = /@(\d+(?:\.\d+)?)x/;

// iOS: 1x, 2x, 3x만 허용 (롤리팝 호환)
const IOS_SCALES = new Set([1, 2, 3]);

/**
 * 에셋 파일을 플랫폼별 출력 디렉토리에 복사.
 * Metro의 saveAssets 동작 호환.
 */
function copyAssets(config: ResolvedConfig, outputDir: string): void {
  const assetExts = new Set(
    (config.resolver?.assetExts ?? []).map((e: string) => (e.startsWith('.') ? e : `.${e}`)),
  );
  if (assetExts.size === 0) return;

  const platform = config.platform ?? 'ios';
  const assetsDir = join(outputDir, 'assets');

  // 번들 소스에서 에셋 파일 수집 (node_modules 제외)
  function walkDir(dir: string) {
    let dirEntries;
    try {
      dirEntries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirEntries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.bungae')
          continue;
        walkDir(fullPath);
      } else if (entry.isFile() && assetExts.has(extname(entry.name).toLowerCase())) {
        copyAssetFile(fullPath, config.root, assetsDir, platform);
      }
    }
  }

  walkDir(config.root);
}

function copyAssetFile(filePath: string, projectRoot: string, assetsDir: string, platform: string) {
  const ext = extname(filePath);
  const nameWithoutExt = basename(filePath, ext);
  const dir = dirname(filePath);

  // 스케일 변형 수집
  const baseNameMatch = nameWithoutExt.match(SCALE_REGEX);
  const baseName = baseNameMatch ? nameWithoutExt.replace(SCALE_REGEX, '') : nameWithoutExt;

  // 디렉토리 내 같은 이름의 스케일 변형 찾기
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.endsWith(ext)) continue;
    const fName = basename(file, ext);
    if (fName !== baseName && !fName.startsWith(`${baseName}@`)) continue;

    const scaleMatch = fName.match(SCALE_REGEX);
    const scale = scaleMatch?.[1] ? parseFloat(scaleMatch[1]) : 1;

    // 플랫폼별 스케일 필터링
    if (platform === 'ios' && !IOS_SCALES.has(scale)) continue;

    const relPath = relative(projectRoot, dir).replace(/\\/g, '/');
    const destDir = join(assetsDir, relPath);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(join(dir, file), join(destDir, file));
  }
}

/**
 * Build bundle using zts (one-shot, no watch)
 */
export async function buildWithZts(
  config: ResolvedConfig,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
): Promise<BuildResult> {
  const outputPath = join(config.outDir, 'bundle.js');

  logInfo('Using zts-bundler (NAPI, in-process)');

  // Signal start
  onProgress?.(0, 1);

  const napiResult = await buildWithNapi(config, outputPath);
  const code = napiResult.code;
  const map = napiResult.map;

  // 에셋 파일 복사 (prod build)
  if (!config.dev) {
    try {
      copyAssets(config, config.outDir);
    } catch (err) {
      logWarn(`Asset copy: ${err}`);
    }
  }

  // Signal completion
  onProgress?.(1, 1);

  return { code, map };
}

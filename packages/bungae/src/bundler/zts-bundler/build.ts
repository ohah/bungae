/**
 * ZTS one-shot build
 */

import { existsSync } from 'fs';
import { join } from 'path';

import type { ResolvedConfig } from '../../config/types';
import { buildWithNapi } from './napi-build';
import type { AssetInfo, BuildResult } from './types';
import { logInfo } from './utils';

/**
 * Extract Metro-compatible asset metadata from the ZTS-emitted registerAsset calls.
 *
 * ZTS core owns AssetRegistry module generation, while Bungae's release copy step
 * expects BuildResult.assets. The generated object includes fileSystemLocation, so
 * we can bridge that metadata without scanning unrelated project files.
 */
function extractAssetsFromBundle(code: string): AssetInfo[] {
  const assets: AssetInfo[] = [];
  const seen = new Set<string>();
  const registerAssetPattern = /registerAsset\(\{([^)]*?"fileSystemLocation"[^)]*?)\}\)/gs;

  for (const match of code.matchAll(registerAssetPattern)) {
    const body = match[1];
    if (!body) continue;

    const fileSystemLocation = readStringField(body, 'fileSystemLocation');
    const httpServerLocation = readStringField(body, 'httpServerLocation');
    const name = readStringField(body, 'name');
    const type = readStringField(body, 'type');
    const width = readNumberField(body, 'width');
    const height = readNumberField(body, 'height');
    const scales = readNumberArrayField(body, 'scales');

    if (!fileSystemLocation || !httpServerLocation || !name || !type || !width || !height) {
      continue;
    }

    const filePath = resolveAssetFile(fileSystemLocation, name, type, scales);
    if (!filePath) continue;

    const key = `${fileSystemLocation}:${name}:${type}:${scales.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    assets.push({
      filePath,
      httpServerLocation,
      name,
      type,
      width,
      height,
      scales,
    });
  }

  return assets;
}

function readStringField(body: string, field: string): string | null {
  const match = body.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`));
  return match?.[1] ?? null;
}

function readNumberField(body: string, field: string): number | null {
  const match = body.match(new RegExp(`"${field}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
  return match?.[1] ? Number(match[1]) : null;
}

function readNumberArrayField(body: string, field: string): number[] {
  const match = body.match(new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]*)\\]`));
  if (!match?.[1]) return [1];
  const values = match[1]
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length > 0 ? values : [1];
}

function resolveAssetFile(
  fileSystemLocation: string,
  name: string,
  type: string,
  scales: number[],
): string | null {
  const candidates = new Set<string>();
  candidates.add(join(fileSystemLocation, `${name}.${type}`));

  for (const scale of scales) {
    if (scale === 1) continue;
    candidates.add(join(fileSystemLocation, `${name}@${scale}x.${type}`));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
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
  const assets = config.dev ? [] : extractAssetsFromBundle(code);

  // Signal completion
  onProgress?.(1, 1);

  return { code, map, assets };
}

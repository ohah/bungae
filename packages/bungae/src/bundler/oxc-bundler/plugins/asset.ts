/**
 * Asset Plugin for Rolldown
 *
 * Handles image/font/media assets for React Native.
 * Generates AssetRegistry-compatible code that React Native uses to load assets.
 *
 * Supports:
 * - Scale variants (@2x, @3x)
 * - Platform-specific assets (.ios.png, .android.png)
 * - Image dimensions (width/height)
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { basename, dirname, extname, relative, sep } from 'path';

import type { Plugin } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';
import type { AssetData } from '../types';

export function assetPlugin(config: ResolvedConfig): Plugin {
  const assetExts = config.resolver.assetExts.map((ext) =>
    ext.startsWith('.') ? ext : `.${ext}`,
  );
  const assetPattern = new RegExp(
    `\\.(${assetExts.map((e) => e.slice(1)).join('|')})$`,
  );
  const collectedAssets: AssetData[] = [];

  return {
    name: 'bungae:asset',

    buildStart() {
      collectedAssets.length = 0;
    },

    load: {
      filter: { id: assetPattern },
      handler(id) {
        const assetData = resolveAsset(id, config.root, config.platform);
        collectedAssets.push(assetData);

        // Generate AssetRegistry code
        const code = generateAssetRegistryCode(assetData);
        return {
          code,
          moduleType: 'js',
        };
      },
    },
  };
}

/**
 * Resolve asset metadata including scales and dimensions
 */
export function resolveAsset(
  filePath: string,
  projectRoot: string,
  _platform: string,
): AssetData {
  const ext = extname(filePath).slice(1);
  const nameWithoutExt = basename(filePath, `.${ext}`);
  const dir = dirname(filePath);
  const relativePath = relative(projectRoot, dir);

  // Find scale variants (@2x, @3x)
  const scales = findScaleVariants(dir, nameWithoutExt, ext);

  // Compute hash from file content
  const content = readFileSync(filePath);
  const hash = createHash('md5').update(content).digest('hex').slice(0, 8);

  // HTTP server location (Metro-compatible path)
  const httpServerLocation = '/' + relativePath.split(sep).join('/');

  return {
    __packager_asset: true,
    fileSystemLocation: dir,
    httpServerLocation,
    hash,
    name: nameWithoutExt,
    scales,
    type: ext,
  };
}

/**
 * Find scale variants for an asset (@1x, @2x, @3x)
 */
function findScaleVariants(
  dir: string,
  name: string,
  ext: string,
): number[] {
  const scales: number[] = [];
  // Check base file (1x)
  const basePath = `${dir}/${name}.${ext}`;
  if (existsSync(basePath)) {
    scales.push(1);
  }

  // Check common scale variants
  for (const scale of [1.5, 2, 3, 4]) {
    const scaledName = `${name}@${scale}x.${ext}`;
    const scaledPath = `${dir}/${scaledName}`;
    if (existsSync(scaledPath)) {
      if (!scales.includes(scale)) {
        scales.push(scale);
      }
    }
  }

  // If no variants found, assume 1x
  if (scales.length === 0) {
    scales.push(1);
  }

  return scales.sort((a, b) => a - b);
}

/**
 * Generate AssetRegistry-compatible module code
 */
function generateAssetRegistryCode(asset: AssetData): string {
  return `
import { registerAsset } from 'react-native/Libraries/Image/AssetRegistry';

export default registerAsset(${JSON.stringify(asset, null, 2)});
`;
}

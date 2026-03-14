/**
 * Asset Plugin for Rolldown
 *
 * Handles image/font/media assets for React Native.
 * Generates AssetRegistry-compatible code that React Native uses to load assets.
 *
 * Metro-compatible features:
 * - Scale variants (@2x, @3x)
 * - Platform-specific assets (.ios.png, .android.png)
 * - Image dimensions (width/height) via image-size
 * - Asset collection for production extraction
 */

import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, dirname, extname, join, relative, sep } from 'path';

import { imageSize } from 'image-size';
import type { Plugin } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';
import type { AssetData } from '../types';

/** Image types that support dimension detection */
const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'psd']);

/** Scale variant regex: name@2x.ext or name@1.5x.ext */
const SCALE_REGEX = /@(\d+(?:\.\d+)?)x$/;

export function assetPlugin(config: ResolvedConfig): Plugin {
  const assetExts = config.resolver.assetExts.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
  const assetPattern = new RegExp(`\\.(${assetExts.map((e) => e.slice(1)).join('|')})$`);
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
 * Resolve asset metadata including scales, dimensions, and platform variants
 */
export function resolveAsset(filePath: string, projectRoot: string, platform: string): AssetData {
  const ext = extname(filePath).slice(1);
  const nameWithoutExt = basename(filePath, `.${ext}`);
  const dir = dirname(filePath);
  const relativePath = relative(projectRoot, dir);

  // Find scale variants and platform-specific files
  const { scales, files } = findAssetVariants(dir, nameWithoutExt, ext, platform);

  // Compute hash from all variant file contents
  const hash = computeAssetHash(files);

  // Detect image dimensions from the base (1x) file
  const dimensions = getImageDimensions(filePath, ext);

  // HTTP server location (Metro-compatible path)
  // For files outside project root (monorepo node_modules), normalize the path
  // e.g., ../../node_modules/.bun/react-native@.../Libraries/LogBox → /node_modules/react-native/Libraries/LogBox
  let httpPath = relativePath.split(sep).join('/');
  if (httpPath.startsWith('..')) {
    // Extract meaningful path: find "node_modules/{package}/..." and simplify
    const nmIdx = httpPath.indexOf('node_modules/');
    if (nmIdx !== -1) {
      httpPath = httpPath.slice(nmIdx);
      // Bun's .bun cache: node_modules/.bun/pkg@ver+hash/node_modules/pkg/...
      // Simplify to: node_modules/pkg/...
      const bunCacheMatch = httpPath.match(/node_modules\/\.bun\/[^/]+\/node_modules\/(.*)/);
      if (bunCacheMatch) {
        httpPath = 'node_modules/' + bunCacheMatch[1];
      }
    }
  }
  const httpServerLocation = '/' + httpPath;

  return {
    __packager_asset: true,
    fileSystemLocation: dir,
    httpServerLocation,
    hash,
    name: nameWithoutExt,
    scales,
    type: ext,
    ...(dimensions && { width: dimensions.width, height: dimensions.height }),
  };
}

/**
 * Find all scale variants and platform-specific variants for an asset.
 * Returns sorted scales and file paths for hash computation.
 */
export function findAssetVariants(
  dir: string,
  name: string,
  ext: string,
  platform: string,
): { scales: number[]; files: string[] } {
  const scales: number[] = [];
  const files: string[] = [];

  let dirEntries: string[];
  try {
    dirEntries = readdirSync(dir);
  } catch {
    return { scales: [1], files: [join(dir, `${name}.${ext}`)] };
  }

  for (const entry of dirEntries) {
    const entryExt = extname(entry).slice(1);
    if (entryExt !== ext) continue;

    const entryBase = basename(entry, `.${ext}`);

    // Check platform-specific: name.ios.ext or name@2x.ios.ext
    const platformSuffix = `.${platform}`;
    const isPlatformSpecific = entryBase.endsWith(platformSuffix);
    const baseName = isPlatformSpecific ? entryBase.slice(0, -platformSuffix.length) : entryBase;

    // Skip other platform files (e.g., .android when building for ios)
    if (!isPlatformSpecific) {
      const otherPlatforms = ['ios', 'android', 'native', 'web'];
      const hasOtherPlatform = otherPlatforms.some(
        (p) => p !== platform && entryBase.endsWith(`.${p}`),
      );
      if (hasOtherPlatform) continue;
    }

    // Extract scale
    const scaleMatch = baseName.match(SCALE_REGEX);
    const scale = scaleMatch ? parseFloat(scaleMatch[1]!) : 1;
    const assetName = scaleMatch ? baseName.replace(SCALE_REGEX, '') : baseName;

    if (assetName !== name) continue;

    // Platform-specific files take priority
    if (isPlatformSpecific || !scales.includes(scale)) {
      if (isPlatformSpecific && scales.includes(scale)) {
        // Replace generic with platform-specific
        const idx = scales.indexOf(scale);
        files[idx] = join(dir, entry);
      } else {
        scales.push(scale);
        files.push(join(dir, entry));
      }
    }
  }

  if (scales.length === 0) {
    scales.push(1);
    files.push(join(dir, `${name}.${ext}`));
  }

  // Sort by scale
  const sorted = scales
    .map((s, i) => ({ scale: s, file: files[i]! }))
    .sort((a, b) => a.scale - b.scale);

  return {
    scales: sorted.map((s) => s.scale),
    files: sorted.map((s) => s.file),
  };
}

/**
 * Compute MD5 hash from all asset variant files
 */
function computeAssetHash(files: string[]): string {
  const hash = createHash('md5');
  for (const file of files) {
    try {
      hash.update(readFileSync(file));
    } catch {
      // File might not exist for computed variants
    }
  }
  return hash.digest('hex').slice(0, 8);
}

/**
 * Detect image dimensions using image-size package.
 * Returns null for non-image assets.
 */
export function getImageDimensions(
  filePath: string,
  ext: string,
): { width: number; height: number } | null {
  if (!IMAGE_TYPES.has(ext.toLowerCase())) return null;

  try {
    const buffer = readFileSync(filePath);
    const result = imageSize(buffer);
    if (result.width && result.height) {
      return { width: result.width, height: result.height };
    }
  } catch {
    // image-size might fail on corrupted/unsupported files
  }
  return null;
}

/**
 * Generate AssetRegistry-compatible module code.
 * Excludes fileSystemLocation and files from the bundle (Metro compat).
 */
function generateAssetRegistryCode(asset: AssetData): string {
  // Metro excludes fileSystemLocation from the bundle
  const bundleAsset = {
    __packager_asset: asset.__packager_asset,
    httpServerLocation: asset.httpServerLocation,
    hash: asset.hash,
    name: asset.name,
    scales: asset.scales,
    type: asset.type,
    ...(asset.width != null && { width: asset.width }),
    ...(asset.height != null && { height: asset.height }),
  };

  // Use module.exports (CJS) so require('./image.png') returns the asset ID
  // directly, not an ESM wrapper { default: id, __esModule: true }.
  // RN's <Image source={require('./image.png')}> expects a number, not an object.
  return `
var registerAsset = require('react-native/Libraries/Image/AssetRegistry').registerAsset;
module.exports = registerAsset(${JSON.stringify(bundleAsset, null, 2)});
`;
}

/**
 * Resolve the best asset file for a given scale.
 * Used by the asset server to serve the right variant.
 */
export function resolveAssetFile(
  dir: string,
  name: string,
  ext: string,
  platform: string,
  requestedScale: number,
): string | null {
  const { scales, files } = findAssetVariants(dir, name, ext, platform);

  // Find the best scale: pick the smallest scale >= requested, or the largest available
  let bestIdx = 0;
  for (let i = 0; i < scales.length; i++) {
    if (scales[i]! >= requestedScale) {
      bestIdx = i;
      break;
    }
    bestIdx = i;
  }

  const file = files[bestIdx];
  if (file && existsSync(file)) return file;
  return null;
}

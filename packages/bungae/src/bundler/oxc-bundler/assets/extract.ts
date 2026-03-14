/**
 * Asset Extraction for Production Builds
 *
 * Copies asset files (images, fonts, etc.) to the output directory
 * for inclusion in the native app bundle.
 *
 * Metro-compatible: uses the same directory structure and naming
 * convention so React Native's asset resolver finds them.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { basename, extname, join, relative } from 'path';

import type { AssetData } from '../types';

/** Scale variant regex */
const SCALE_REGEX = /@(\d+(?:\.\d+)?)x$/;

export interface ExtractAssetsOptions {
  /** Output directory for assets (e.g., 'dist/assets') */
  outputDir: string;
  /** Project root for computing relative paths */
  projectRoot: string;
  /** Target platform */
  platform: string;
}

export interface ExtractResult {
  /** Number of assets extracted */
  count: number;
  /** Total bytes copied */
  totalSize: number;
  /** Extracted file paths */
  files: string[];
}

/**
 * Extract all collected assets to the output directory.
 * Copies the best scale variant for each asset.
 */
export function extractAssets(assets: AssetData[], options: ExtractAssetsOptions): ExtractResult {
  const { outputDir, projectRoot, platform } = options;
  const extractedFiles: string[] = [];
  let totalSize = 0;

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  for (const asset of assets) {
    const dir = asset.fileSystemLocation;
    const ext = asset.type;
    const name = asset.name;

    // Find all variant files in the directory
    const variants = findVariantFiles(dir, name, ext, platform);

    // Compute output subdirectory (preserves relative path structure)
    const relativeDir = relative(projectRoot, dir);
    const assetOutputDir = join(outputDir, relativeDir);
    mkdirSync(assetOutputDir, { recursive: true });

    // Copy each variant to output
    for (const variant of variants) {
      const outputPath = join(assetOutputDir, basename(variant));
      try {
        copyFileSync(variant, outputPath);
        const stat = existsSync(outputPath) ? require('fs').statSync(outputPath) : null;
        totalSize += stat?.size || 0;
        extractedFiles.push(outputPath);
      } catch {
        // Skip files that can't be copied
      }
    }
  }

  return {
    count: assets.length,
    totalSize,
    files: extractedFiles,
  };
}

/**
 * Find all variant files for an asset (all scales + platform-specific).
 */
function findVariantFiles(dir: string, name: string, ext: string, platform: string): string[] {
  const files: string[] = [];

  let dirEntries: string[];
  try {
    dirEntries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of dirEntries) {
    const entryExt = extname(entry).slice(1);
    if (entryExt !== ext) continue;

    const entryBase = basename(entry, `.${ext}`);

    // Skip other platform files
    const platformSuffix = `.${platform}`;
    const otherPlatforms = ['ios', 'android', 'native', 'web'];
    const hasOtherPlatform = otherPlatforms.some(
      (p) => p !== platform && entryBase.endsWith(`.${p}`),
    );
    if (hasOtherPlatform) continue;

    // Extract base name (without scale and platform)
    let baseName = entryBase;
    if (baseName.endsWith(platformSuffix)) {
      baseName = baseName.slice(0, -platformSuffix.length);
    }
    baseName = baseName.replace(SCALE_REGEX, '');

    if (baseName === name) {
      files.push(join(dir, entry));
    }
  }

  return files;
}

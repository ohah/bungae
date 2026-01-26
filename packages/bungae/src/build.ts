/**
 * Build command - Create production bundle
 */

import { writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'fs';
import { resolve, join, dirname } from 'path';

import { buildWithGraph } from './bundler';
import type { ResolvedConfig } from './config/types';

// VERSION constant (same as in index.ts to avoid circular dependency)
const VERSION = '0.0.1';

export async function build(config: ResolvedConfig): Promise<void> {
  const { entry, platform, dev, outDir, root } = config;

  console.log(`Building bundle for ${platform}... (Graph bundler)`);
  console.log(`Entry: ${entry}`);
  console.log(`Output: ${outDir}`);

  // Build using Graph bundler with Metro __d()/__r() module system
  // This ensures correct module execution order for React Native
  const buildResult = await buildWithGraph(config);

  // Extract asset files from the build result for Android/iOS asset copying
  const assetFiles = buildResult.assets || [];

  // Log asset detection
  if (assetFiles.length > 0) {
    console.log(`   📦 Found ${assetFiles.length} asset file(s) in bundle`);
  } else {
    console.log(`   ⚠️  No asset files detected in bundle`);
  }

  // Ensure output directory exists
  const outputDir = resolve(root, outDir);
  mkdirSync(outputDir, { recursive: true });

  // Generate bundle file name
  const entryBaseName =
    entry
      .split('/')
      .pop()
      ?.replace(/\.(js|ts|jsx|tsx)$/, '') || 'index';
  let bundleFileName: string;
  if (platform === 'ios') {
    bundleFileName = dev ? `${entryBaseName}.jsbundle` : 'main.jsbundle';
  } else if (platform === 'android') {
    bundleFileName = `${entryBaseName}.android.bundle`;
  } else {
    bundleFileName = `${entryBaseName}.bundle.js`;
  }

  const bundlePath = join(outputDir, bundleFileName);
  const mapFileName = `${bundleFileName}.map`;
  const mapPath = join(outputDir, mapFileName);

  // Add sourcemap reference to bundle if map exists
  let bundleCode = buildResult.code;
  if (buildResult.map) {
    bundleCode = `${bundleCode}\n//# sourceMappingURL=${mapFileName}`;
  }

  writeFileSync(bundlePath, bundleCode, 'utf-8');

  // Write sourcemap to separate file
  if (buildResult.map) {
    writeFileSync(mapPath, buildResult.map, 'utf-8');
    console.log(`\n✅ Bundle written to: ${bundlePath}`);
    console.log(`   Sourcemap: ${mapPath}`);
  } else {
    console.log(`\n✅ Bundle written to: ${bundlePath}`);
  }

  console.log(`   Size: ${(bundleCode.length / 1024).toFixed(2)} KB`);
  console.log(`   Bundler: Bungae v${VERSION}`);
  console.log(`   Dev mode: ${dev}, Platform: ${platform}`);

  // Copy bundle and assets to React Native expected locations
  // Metro behavior:
  // - Development mode: Assets are served over HTTP from dev server (not copied to filesystem)
  // - Release mode: Assets are copied to drawable folders via `react-native bundle --assets-dest`
  // We copy assets in both dev and release builds for better compatibility
  if (platform === 'android' || platform === 'ios') {
    console.log(`   🔄 Attempting to copy bundle for ${platform} (dev: ${dev})...`);
    if (platform === 'android') {
      // Android: Copy to android/app/src/main/assets/
      const androidAssetsDir = join(root, 'android', 'app', 'src', 'main', 'assets');
      const androidParentDir = dirname(androidAssetsDir);
      console.log(`   📍 Checking Android directory: ${androidParentDir}`);
      if (existsSync(androidParentDir)) {
        mkdirSync(androidAssetsDir, { recursive: true });
        const androidBundlePath = join(androidAssetsDir, bundleFileName);
        copyFileSync(bundlePath, androidBundlePath);
        console.log(`   📦 Copied bundle to: ${androidBundlePath}`);

        // Copy assets to Android drawable folders (Metro-compatible)
        // Metro copies assets to multiple drawable folders based on scales array
        // Scale mapping from Metro's assetPathUtils.js: 0.75->ldpi, 1->mdpi, 1.5->hdpi, 2->xhdpi, 3->xxhdpi, 4->xxxhdpi
        if (assetFiles && assetFiles.length > 0) {
          // Metro scale to drawable folder mapping (from Metro's assetPathUtils.js)
          const scaleToDrawable: Record<number, string> = {
            0.75: 'ldpi',
            1: 'mdpi',
            1.5: 'hdpi',
            2: 'xhdpi',
            3: 'xxhdpi',
            4: 'xxxhdpi',
          };

          // Helper function to get drawable folder name from scale (Metro-compatible)
          const getDrawableFolderName = (scale: number): string => {
            if (scaleToDrawable[scale]) {
              return `drawable-${scaleToDrawable[scale]}`;
            }
            // For custom scales, Metro uses format: drawable-{round(160*scale)}dpi
            if (Number.isFinite(scale) && scale > 0) {
              return `drawable-${Math.round(160 * scale)}dpi`;
            }
            return 'drawable-mdpi'; // Fallback
          };

          console.log(
            `   🖼️  Copying ${assetFiles.length} asset(s) to Android drawable folders...`,
          );

          // Collect all drawable resource names for keep.xml
          const drawableResourceNames: string[] = [];

          for (const asset of assetFiles) {
            // Metro file naming: convert httpServerLocation path to filename
            // Example: /assets/../../node_modules/.../assets -> __node_modules_..._assets
            let assetFileName =
              asset.httpServerLocation
                .replace(/^\/assets\//, '') // Remove /assets/ prefix
                .replace(/^(\.\.\/)+/, '') // Remove leading ../
                .replace(/\//g, '_') // Convert / to _
                .replace(/[^a-z0-9_]/gi, '') + // Remove special characters (Metro-compatible)
              `_${asset.name}.${asset.type}`;

            // Ensure filename starts with __ (Metro convention for node_modules assets)
            if (!assetFileName.startsWith('__')) {
              assetFileName = `__${assetFileName}`;
            }

            // Remove file extension for drawable resource name (Metro-compatible)
            const drawableResourceName = assetFileName.replace(
              /\.(png|jpg|jpeg|gif|webp|bmp|avif|ico|icns|icxl)$/i,
              '',
            );

            // Metro copies asset to drawable folder(s) based on scales array
            // For scales: [1], copy to drawable-mdpi
            // For scales: [1, 2, 3], copy to drawable-mdpi, drawable-xhdpi, drawable-xxhdpi
            const scales = asset.scales || [1];
            for (const scale of scales) {
              const drawableFolderName = getDrawableFolderName(scale);
              const drawableDir = join(
                root,
                'android',
                'app',
                'src',
                'main',
                'res',
                drawableFolderName,
              );
              mkdirSync(drawableDir, { recursive: true });

              const targetPath = join(drawableDir, assetFileName);
              copyFileSync(asset.filePath, targetPath);
              console.log(
                `      ✅ ${asset.name}.${asset.type} -> ${drawableFolderName}/${assetFileName}`,
              );
            }

            // Add drawable resource name to keep list (only once per asset, not per scale)
            if (!drawableResourceNames.includes(drawableResourceName)) {
              drawableResourceNames.push(drawableResourceName);
            }
          }
          console.log(`   ✅ Assets copied to Android drawable folders`);

          // Generate/update keep.xml file (Metro-compatible)
          // Metro creates keep.xml to prevent Android resource shrinking from removing drawable resources
          if (drawableResourceNames.length > 0) {
            const rawDir = join(root, 'android', 'app', 'src', 'main', 'res', 'raw');
            mkdirSync(rawDir, { recursive: true });
            const keepXmlPath = join(rawDir, 'keep.xml');

            // Generate keep.xml content (Metro-compatible format)
            const keepXmlContent = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="${drawableResourceNames.map((name) => `@drawable/${name}`).join(',')}" />
`;

            writeFileSync(keepXmlPath, keepXmlContent, 'utf-8');
            console.log(
              `   ✅ Updated keep.xml with ${drawableResourceNames.length} drawable resource(s)`,
            );
          }
        }
      } else {
        console.log(`   ⚠️  Android assets directory not found: ${androidParentDir}`);
      }
    } else if (platform === 'ios') {
      // iOS: Copy to ios/ directory (will be included in Xcode project)
      const iosDir = join(root, 'ios');
      console.log(`   📍 Checking iOS directory: ${iosDir}`);
      if (existsSync(iosDir)) {
        const iosBundlePath = join(iosDir, bundleFileName);
        console.log(`   📍 Target iOS bundle path: ${iosBundlePath}`);
        copyFileSync(bundlePath, iosBundlePath);
        console.log(`   📦 Copied to: ${iosBundlePath}`);
        console.log(`   ✅ iOS bundle ready for Xcode build`);

        // Verify the copy
        if (existsSync(iosBundlePath)) {
          const stats = statSync(iosBundlePath);
          console.log(
            `   ✅ Verified: ${iosBundlePath} exists (${(stats.size / 1024).toFixed(2)} KB)`,
          );
        } else {
          console.log(`   ❌ ERROR: Copy failed - file not found at ${iosBundlePath}`);
        }

        // Copy assets to iOS (Metro-compatible)
        // Metro copies assets to ios/assets/ directory with the same structure as httpServerLocation
        if (assetFiles && assetFiles.length > 0) {
          console.log(`   🖼️  Copying ${assetFiles.length} asset(s) to iOS assets directory...`);

          // Metro creates ios/assets/ folder structure
          const iosAssetsDir = join(iosDir, 'assets');
          mkdirSync(iosAssetsDir, { recursive: true });

          for (const asset of assetFiles) {
            // Metro iOS asset path: ios/assets/{httpServerLocation}/{name}.{type}
            // Example: /assets/../../node_modules/.../assets -> ios/assets/__node_modules_..._assets/{name}.{type}
            let assetPath =
              asset.httpServerLocation
                .replace(/^\/assets\//, '') // Remove /assets/ prefix
                .replace(/^(\.\.\/)+/, '') // Remove leading ../
                .replace(/\//g, '_') // Convert / to _
                .replace(/[^a-z0-9_]/gi, '') + // Remove special characters (Metro-compatible)
              `_${asset.name}.${asset.type}`;

            // Ensure filename starts with __ (Metro convention for node_modules assets)
            if (!assetPath.startsWith('__')) {
              assetPath = `__${assetPath}`;
            }

            // Metro copies assets to ios/assets/ directory
            const iosAssetPath = join(iosAssetsDir, assetPath);
            const iosAssetDir = dirname(iosAssetPath);
            mkdirSync(iosAssetDir, { recursive: true });

            copyFileSync(asset.filePath, iosAssetPath);
            console.log(`      ✅ ${asset.name}.${asset.type} -> assets/${assetPath}`);
          }
          console.log(`   ✅ Assets copied to iOS assets directory`);
        }
      } else {
        console.log(`   ⚠️  iOS directory not found: ${iosDir}`);
        console.log(`   📍 Current root: ${root}`);
      }
    }
  } else if (dev) {
    console.log(`   ℹ️  Development mode: Skipping bundle copy to native directories`);
  }
}

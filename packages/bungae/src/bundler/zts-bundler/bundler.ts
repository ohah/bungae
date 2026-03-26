/**
 * ZTS Bundler - Zig NAPI-based React Native Bundler
 *
 * Uses ZTS native addon for parsing, transformation, bundling, and source map
 * generation. All heavy work is done in Zig; this JS layer handles:
 * - Config → ZTS options mapping
 * - Babel fallback for user plugins
 * - Source map post-processing (x_google_ignoreList, x_facebook_sources)
 * - Hermes bytecode compilation
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

import type { ResolvedConfig } from '../../config/types';
import { loadZtsBinding } from './binding';
import { resolvePolyfillPaths } from './polyfills';
import { buildExtensions, generatePreludeCode } from './prelude';
import { postProcessSourceMap } from './sourcemap';
import { createBabelTransformCallback } from './babel-fallback';
import type { ZtsBuildResult, ZtsBuildOptions } from './types';

/**
 * Build React Native bundle using ZTS
 */
export async function buildWithZts(
  config: ResolvedConfig,
  onProgress?: (processed: number, total: number) => void,
  options: ZtsBuildOptions = {},
): Promise<ZtsBuildResult> {
  const {
    outfile,
    minify = config.minify,
    sourcemap = config.dev ? true : false,
    hermes = !config.dev,
  } = options;

  const entryPath = resolve(config.root, config.entry);
  if (!existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  const startTime = Date.now();
  console.log('⚡ Bundling with ZTS...');

  // Load ZTS NAPI addon
  const zts = loadZtsBinding();

  // Build platform-specific extensions list
  const extensions = buildExtensions(config.platform, config.resolver.sourceExts);
  const polyfillPaths = resolvePolyfillPaths(config.root);
  const preludeCode = generatePreludeCode(config.dev, config.platform);

  // Create Babel fallback callback for user plugins
  const babelTransform = createBabelTransformCallback(config);

  // Call ZTS native bundler
  const nativeResult = zts.bundle({
    entry: entryPath,
    root: config.root,
    platform: config.platform,
    dev: config.dev,
    extensions,
    mainFields: ['react-native', 'browser', 'main', 'module'],
    conditionNames: ['react-native', 'import', 'require', 'default'],
    treeshake: !config.dev,
    minify,
    sourcemap: sourcemap === true || sourcemap === 'inline' || sourcemap === 'hidden',
    preludeCode,
    polyfillPaths,
    babelTransform,
  });

  const bundleDuration = Date.now() - startTime;

  let code = nativeResult.code;
  let map = nativeResult.map;

  // Post-process source map for DevTools compatibility
  if (map) {
    map = postProcessSourceMap(map);
  }

  // Handle inline source map
  if (sourcemap === 'inline' && map) {
    const base64Map = Buffer.from(map).toString('base64');
    code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64Map}`;
    map = undefined;
  }

  console.log(`  Bundling done in ${bundleDuration}ms`);

  // Write output files if outfile is specified
  let hermesBytecode: string | undefined;
  if (outfile) {
    const outDir = dirname(outfile);
    mkdirSync(outDir, { recursive: true });

    writeFileSync(outfile, code, 'utf-8');
    console.log(`  Output: ${outfile} (${formatSize(Buffer.byteLength(code))})`);

    if (map) {
      const mapFile = `${outfile}.map`;
      writeFileSync(mapFile, map, 'utf-8');
      console.log(`  Source map: ${mapFile}`);
    }

    // Hermes bytecode compilation
    if (hermes) {
      console.log('  Compiling to Hermes bytecode...');
      try {
        const { compileToHermesBytecode } = await import('../oxc-bundler/hermes/compiler');
        const hermesResult = await compileToHermesBytecode({
          input: outfile,
          output: outfile.replace(/\.(js|bundle)$/, '.hbc'),
          sourceMap: !!map,
          inputSourceMap: map ? `${outfile}.map` : undefined,
          optimize: !config.dev,
          projectRoot: config.root,
        });
        hermesBytecode = hermesResult.outputPath;
        console.log(
          `  Hermes: ${hermesResult.outputPath} (${formatSize(hermesResult.size)}) in ${hermesResult.duration}ms`,
        );
      } catch (error: any) {
        console.warn(`  Hermes compilation skipped: ${error.message}`);
      }
    }
  }

  const totalDuration = Date.now() - startTime;
  console.log(`  Total: ${totalDuration}ms`);

  return {
    code,
    map,
    hermesBytecode,
    assets: [],
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * ZTS Bundler - Zig NAPI-based React Native Bundler
 *
 * All heavy lifting (parsing, transformation, bundling, source maps) is done
 * in Zig via NAPI. This JS layer maps config to ZTS options, runs Babel
 * fallback for user plugins, and handles Hermes bytecode compilation.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

import type { ResolvedConfig } from '../../config/types';
import { formatSize } from '../shared/format';
import { postProcessSourceMap } from '../shared/sourcemap';
import { RN_MAIN_FIELDS, RN_CONDITION_NAMES } from '../shared/resolve-config';
import { loadZtsBinding } from './binding';
import { resolvePolyfillPaths } from './polyfills';
import { buildExtensions, generatePreludeCode } from './prelude';
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
  const startTime = Date.now();
  console.log('⚡ Bundling with ZTS...');

  const zts = loadZtsBinding();
  const extensions = buildExtensions(config.platform, config.resolver.sourceExts);
  const polyfillPaths = resolvePolyfillPaths(config.root);
  const preludeCode = generatePreludeCode(config.dev, config.platform);
  const babelTransform = createBabelTransformCallback(config);

  const nativeResult = zts.bundle({
    entry: entryPath,
    root: config.root,
    platform: config.platform,
    dev: config.dev,
    extensions,
    mainFields: [...RN_MAIN_FIELDS],
    conditionNames: [...RN_CONDITION_NAMES],
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

  if (map) {
    map = postProcessSourceMap(map);
  }

  if (sourcemap === 'inline' && map) {
    const base64Map = Buffer.from(map).toString('base64');
    code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64Map}`;
    map = undefined;
  }

  console.log(`  Bundling done in ${bundleDuration}ms`);

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

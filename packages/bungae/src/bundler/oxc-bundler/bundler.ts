/**
 * OXC Bundler - Rolldown-based React Native Bundler
 *
 * Uses Rolldown with strictExecutionOrder to guarantee ESM module execution order,
 * which is critical for React Native (InitializeCore → react → react-native → App).
 *
 * Pipeline:
 * 1. Rolldown bundles with plugins (flow-strip, asset, json, platform-resolver, prelude)
 * 2. Optionally compiles to Hermes bytecode
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

import type { InputOptions, OutputOptions, Plugin } from 'rolldown';
import { rolldown } from 'rolldown';

import type { ResolvedConfig } from '../../config/types';
import { compileToHermesBytecode } from './hermes/compiler';
import {
  platformResolverPlugin,
  buildExtensions,
  flowStripPlugin,
  jsonPlugin,
  assetPlugin,
  preludePlugin,
  hermesCompatPlugin,
  babelPluginsPlugin,
  generatePreludeCode,
} from './plugins';
import { resolvePolyfillPaths } from './polyfills';
import type { OxcBuildResult, OxcBuildOptions } from './types';

export interface RolldownOptionsResult {
  inputOptions: InputOptions;
  outputOptions: OutputOptions;
}

/**
 * Create shared Rolldown input/output options.
 * Used by both buildWithOxc() and OxcDevEngine.
 */
export function createRolldownOptions(
  config: ResolvedConfig,
  options: {
    sourcemap?: boolean | 'inline' | 'hidden';
    minify?: boolean;
    dev?: boolean;
    extraPlugins?: Plugin[];
  } = {},
): RolldownOptionsResult {
  const {
    sourcemap = config.dev ? true : false,
    minify: minifyOpt = config.minify,
    dev = config.dev,
    extraPlugins = [],
  } = options;

  const entryPath = resolve(config.root, config.entry);
  const preludeModules = resolvePreludeModules(config);
  const polyfillPaths = resolvePolyfillPaths(config.root);
  const extensions = buildExtensions(config.platform, config.resolver.sourceExts);

  const inputOptions: InputOptions = {
    input: entryPath,
    platform: 'neutral',
    cwd: config.root,
    resolve: {
      extensions,
      mainFields: ['react-native', 'browser', 'main', 'module'],
      conditionNames: ['react-native', 'import', 'require', 'default'],
    },
    treeshake: dev ? false : true,
    shimMissingExports: true,
    plugins: [
      preludePlugin(config, { preludeModules, polyfillPaths }),
      flowStripPlugin(config),
      assetPlugin(config),
      jsonPlugin(),
      platformResolverPlugin(config),
      babelPluginsPlugin(config),
      hermesCompatPlugin(),
      ...extraPlugins,
    ].filter(Boolean),
  };

  const outputOptions: OutputOptions = {
    format: 'esm',
    strictExecutionOrder: true,
    sourcemap: sourcemap === true || sourcemap === 'inline' || sourcemap === 'hidden',
    minify: minifyOpt,
  };

  return { inputOptions, outputOptions };
}

/**
 * Build React Native bundle using Rolldown
 */
export async function buildWithOxc(
  config: ResolvedConfig,
  onProgress?: (processed: number, total: number) => void,
  options: OxcBuildOptions = {},
): Promise<OxcBuildResult> {
  const {
    outfile,
    minify = config.minify,
    sourcemap = config.dev ? true : false,
    hermes = !config.dev, // Default: Hermes in production
  } = options;

  const entryPath = resolve(config.root, config.entry);
  if (!existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  const startTime = Date.now();
  console.log('⚡ Bundling with Rolldown...');

  const { inputOptions, outputOptions } = createRolldownOptions(config, {
    sourcemap,
    minify,
  });

  // Configure Rolldown
  const bundle = await rolldown(inputOptions);

  // Generate output
  // Prelude globals (__DEV__, process.env) go in intro because they must be
  // available before any module code. Polyfills are imported as modules via
  // preludePlugin for proper source maps.
  // IIFE prevents top-level `var` from creating non-configurable globalThis props.
  const prelude = generatePreludeCode(config.dev, config.platform);
  const { output } = await bundle.generate({
    ...outputOptions,
    intro: `var global = globalThis;\n${prelude}\n(function() {`,
    outro: '}).call(globalThis);',
  });

  await bundle.close();

  const bundleDuration = Date.now() - startTime;

  // Get the main chunk
  const mainChunk = output.find((o) => o.type === 'chunk' && o.isEntry);
  if (!mainChunk || mainChunk.type !== 'chunk') {
    throw new Error('No output chunk generated');
  }

  let code = mainChunk.code;
  let map = mainChunk.map?.toString();

  // Add x_google_ignoreList for node_modules sources
  if (map) {
    map = postProcessSourceMap(map);
  }

  // Handle inline source map
  if (sourcemap === 'inline' && map) {
    const base64Map = Buffer.from(map).toString('base64');
    code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64Map}`;
    map = undefined;
  }

  console.log(`  Bundling done in ${bundleDuration}ms (${output.length} chunks)`);

  // Collect assets from asset plugin
  const assets = output
    .filter((o) => o.type === 'asset')
    .map((a) => JSON.parse(typeof a.source === 'string' ? a.source : '{}'));

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
    assets,
  };
}

/**
 * Post-process source map for Metro/DevTools compatibility:
 * - ignoreList / x_google_ignoreList: marks node_modules sources so DevTools
 *   skips them for console.log source links
 * - x_facebook_sources: Metro-compatible function map metadata (null entries
 *   since Rolldown doesn't generate function maps)
 */
export function postProcessSourceMap(mapStr: string): string {
  try {
    const map = JSON.parse(mapStr);
    if (!map.sources) return mapStr;

    // Build ignore list for node_modules sources
    const ignore: number[] = [];
    for (let i = 0; i < map.sources.length; i++) {
      const source = map.sources[i];
      if (source && source.indexOf('node_modules') >= 0) {
        ignore.push(i);
      }
    }

    if (ignore.length > 0) {
      map.ignoreList = ignore;
      map.x_google_ignoreList = ignore;
    }

    // Add x_facebook_sources (Metro-compatible function map metadata).
    // Rolldown doesn't generate function maps, so all entries are null.
    // DevTools/Hermes uses this field for stack trace function name resolution.
    map.x_facebook_sources = new Array(map.sources.length).fill(null);

    return JSON.stringify(map);
  } catch {
    // If parsing fails, return original
  }
  return mapStr;
}

/**
 * Resolve modules that must run before the main module
 * (e.g., InitializeCore for React Native)
 */
function resolvePreludeModules(config: ResolvedConfig): string[] {
  if (!config.serializer?.getModulesRunBeforeMainModule) return [];

  try {
    const entryPath = resolve(config.root, config.entry);
    return config.serializer.getModulesRunBeforeMainModule(entryPath, {
      projectRoot: config.root,
      nodeModulesPaths: config.resolver.nodeModulesPaths,
    });
  } catch {
    return [];
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

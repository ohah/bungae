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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
  generatePreludeCode,
  chunkLoaderPlugin,
  generateChunkLoaderRuntime,
} from './plugins';
import type { OxcBuildResult, OxcBuildOptions, ChunkInfo } from './types';

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
    /** Dev server host/port for chunk loader (dev mode) */
    host?: string;
    port?: number;
  } = {},
): RolldownOptionsResult {
  const {
    sourcemap = config.dev ? true : false,
    minify: minifyOpt = config.minify,
    dev = config.dev,
    extraPlugins = [],
    host = 'localhost',
    port = config.server?.port || 8081,
  } = options;

  const codeSplitting = config.experimental?.codeSplitting === true && config.bundler === 'oxc';
  const entryPath = resolve(config.root, config.entry);
  const preludeModules = resolvePreludeModules(config);
  const extensions = buildExtensions(config.platform, config.resolver.sourceExts);

  const plugins: Plugin[] = [
    preludePlugin(config, { preludeModules }),
    flowStripPlugin(config),
    assetPlugin(config),
    jsonPlugin(),
    platformResolverPlugin(config),
  ];

  // chunk-loader must run BEFORE hermes-compat so replaced code also gets ES5 downlevel
  if (codeSplitting) {
    plugins.push(chunkLoaderPlugin({ host, port, dev }));
  }

  plugins.push(hermesCompatPlugin());
  plugins.push(...extraPlugins);

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
    plugins,
  };

  const outputOptions: OutputOptions = {
    format: 'esm',
    strictExecutionOrder: true,
    sourcemap: sourcemap === true || sourcemap === 'inline' || sourcemap === 'hidden',
    minify: minifyOpt,
  };

  if (codeSplitting) {
    (outputOptions as any).codeSplitting = true;
    outputOptions.chunkFileNames = '[name]-[hash].js';
  }

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

  const codeSplitting = config.experimental?.codeSplitting === true && config.bundler === 'oxc';

  const { inputOptions, outputOptions } = createRolldownOptions(config, {
    sourcemap,
    minify,
  });

  // Configure Rolldown
  const bundle = await rolldown(inputOptions);

  // Resolve prelude + polyfills (must execute before any module code)
  const prelude = generatePreludeCode(config.dev, config.platform);
  const polyfillCode = await loadRNPolyfills(config.root);

  // Generate output
  // Use intro to prepend globals/polyfills and wrap chunk in IIFE.
  // IIFE prevents top-level `var` declarations (e.g., `var Headers` from
  // fetch.js) from creating non-configurable properties on globalThis,
  // which would break React Native's polyfillGlobal().
  let introOption: string | ((chunk: any) => string);
  let outroOption: string | ((chunk: any) => string);

  if (codeSplitting) {
    // With code splitting, only entry chunk gets prelude/polyfills/chunk-loader.
    // Non-entry chunks get just IIFE wrapping.
    const chunkLoaderRuntime = generateChunkLoaderRuntime({
      host: 'localhost',
      port: config.server?.port || 8081,
      dev: config.dev,
    });
    const entryIntro = `var global = globalThis;\n${prelude}\n${polyfillCode}\n${chunkLoaderRuntime}\n(function() {`;
    const chunkIntro = '(function() {';
    introOption = (chunk: any) => chunk.isEntry ? entryIntro : chunkIntro;
    outroOption = '}).call(globalThis);';
  } else {
    introOption = `var global = globalThis;\n${prelude}\n${polyfillCode}\n(function() {`;
    outroOption = '}).call(globalThis);';
  }

  const { output } = await bundle.generate({
    ...outputOptions,
    intro: introOption,
    outro: outroOption,
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

  // Collect non-entry chunks (code splitting)
  let chunks: ChunkInfo[] | undefined;
  if (codeSplitting) {
    const nonEntryChunks = output.filter(
      (o) => o.type === 'chunk' && !o.isEntry,
    );
    if (nonEntryChunks.length > 0) {
      chunks = nonEntryChunks.map((chunk) => {
        if (chunk.type !== 'chunk') throw new Error('Unexpected asset in chunks');
        return {
          name: chunk.name,
          fileName: chunk.fileName,
          code: chunk.code,
          map: chunk.map?.toString(),
          isDynamicEntry: chunk.isDynamicEntry,
        };
      });
    }
  }

  // Handle inline source map
  if (sourcemap === 'inline' && map) {
    const base64Map = Buffer.from(map).toString('base64');
    code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64Map}`;
    map = undefined;
  }

  const chunkCount = (chunks?.length || 0) + 1;
  console.log(`  Bundling done in ${bundleDuration}ms (${chunkCount} chunk${chunkCount > 1 ? 's' : ''})`);

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

    // Write non-entry chunks to chunks/ subdirectory
    if (chunks && chunks.length > 0) {
      const chunksDir = resolve(outDir, 'chunks');
      mkdirSync(chunksDir, { recursive: true });
      for (const chunk of chunks) {
        const chunkPath = resolve(chunksDir, chunk.fileName);
        writeFileSync(chunkPath, chunk.code, 'utf-8');
        console.log(`  Chunk: ${chunkPath} (${formatSize(Buffer.byteLength(chunk.code))})`);
        if (chunk.map) {
          writeFileSync(`${chunkPath}.map`, chunk.map, 'utf-8');
        }
      }
    }

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

        // Compile non-entry chunks to Hermes bytecode
        if (chunks && chunks.length > 0) {
          const chunksDir = resolve(outDir, 'chunks');
          for (const chunk of chunks) {
            try {
              const chunkPath = resolve(chunksDir, chunk.fileName);
              await compileToHermesBytecode({
                input: chunkPath,
                output: chunkPath.replace(/\.js$/, '.hbc'),
                sourceMap: !!chunk.map,
                inputSourceMap: chunk.map ? `${chunkPath}.map` : undefined,
                optimize: !config.dev,
                projectRoot: config.root,
              });
            } catch (error: any) {
              console.warn(`  Hermes compilation skipped for chunk ${chunk.fileName}: ${error.message}`);
            }
          }
        }
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
    chunks,
  };
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

/**
 * Load React Native polyfills (console, error-guard) from rn-get-polyfills.
 * These are Flow files that need Babel + hermes-parser for type stripping.
 * Same approach as Rollipop: read polyfill files → strip Flow → wrap in IIFE.
 * Cached after first load since polyfills don't change during a session.
 */
let cachedPolyfillCode: string | null = null;

async function loadRNPolyfills(projectRoot: string): Promise<string> {
  if (cachedPolyfillCode !== null) return cachedPolyfillCode;

  try {
    // Get polyfill paths from React Native
    const rnGetPolyfills = require(
      require.resolve('react-native/rn-get-polyfills', { paths: [projectRoot] }),
    ) as () => string[];
    const polyfillPaths = rnGetPolyfills();

    const babel = await import('@babel/core');
    const swc = await import('@swc/core');

    // Read each polyfill, strip Flow types with Babel, downlevel to ES5 with SWC, wrap in IIFE
    const codes: string[] = [];
    for (const polyfillPath of polyfillPaths) {
      const source = readFileSync(polyfillPath, 'utf-8');

      // Step 1: Strip Flow types with Babel + hermes-parser
      const babelResult = await babel.transformAsync(source, {
        filename: polyfillPath,
        babelrc: false,
        configFile: false,
        sourceMaps: false,
        plugins: [
          [
            require.resolve('babel-plugin-syntax-hermes-parser'),
            { parseLangTypes: 'flow', reactRuntimeTarget: '19' },
          ],
          require.resolve('@babel/plugin-transform-flow-strip-types'),
        ],
      });
      if (!babelResult?.code) continue;

      // Step 2: Downlevel to ES5 with SWC (Hermes compat)
      const swcResult = await swc.transform(babelResult.code, {
        jsc: {
          parser: { syntax: 'ecmascript' },
          target: 'es5',
          assumptions: { setPublicClassFields: true, privateFieldsAsProperties: true },
        },
        sourceMaps: false,
      });

      codes.push(`(function(global){${swcResult.code}})(globalThis);`);
    }

    cachedPolyfillCode = codes.join('\n');
  } catch {
    cachedPolyfillCode = '';
  }

  return cachedPolyfillCode;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

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
  hmrClientReplacePlugin,
  reactRefreshPlugin,
  generatePreludeCode,
} from './plugins';
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
    plugins: [
      preludePlugin(config, { preludeModules }),
      flowStripPlugin(config),
      assetPlugin(config),
      jsonPlugin(),
      platformResolverPlugin(config),
      hermesCompatPlugin(),
      ...extraPlugins,
    ],
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

  // Resolve prelude + polyfills (must execute before any module code)
  const prelude = generatePreludeCode(config.dev, config.platform);
  const polyfillCode = await loadRNPolyfills(config.root);

  // Generate output
  // Use intro to prepend globals/polyfills and wrap chunk in IIFE.
  // IIFE prevents top-level `var` declarations (e.g., `var Headers` from
  // fetch.js) from creating non-configurable properties on globalThis,
  // which would break React Native's polyfillGlobal().
  const { output } = await bundle.generate({
    ...outputOptions,
    intro: `var global = globalThis;\n${prelude}\n${polyfillCode}\n(function() {`,
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

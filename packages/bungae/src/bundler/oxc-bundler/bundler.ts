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
} from './plugins';
import type { OxcBuildResult, OxcBuildOptions } from './types';

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

  // Resolve prelude modules (InitializeCore, etc.)
  const preludeModules = resolvePreludeModules(config);

  // Build extension list for Rolldown resolver
  const extensions = buildExtensions(
    config.platform,
    config.resolver.sourceExts,
  );

  // Configure Rolldown
  const bundle = await rolldown({
    input: entryPath,
    platform: 'neutral', // RN is neither browser nor node
    cwd: config.root,

    resolve: {
      extensions,
      mainFields: ['react-native', 'browser', 'main', 'module'],
      conditionNames: ['react-native', 'import', 'require', 'default'],
    },

    // __DEV__ and process.env.NODE_ENV are set in the prelude plugin

    treeshake: config.dev ? false : true,

    plugins: [
      preludePlugin(config, { preludeModules }),
      flowStripPlugin(config),
      assetPlugin(config),
      jsonPlugin(),
      platformResolverPlugin(config),
    ],
  });

  // Generate output
  const { output } = await bundle.generate({
    format: 'esm',
    // @ts-expect-error - strictExecutionOrder is Rolldown-specific
    strictExecutionOrder: true,
    sourcemap: sourcemap === true || sourcemap === 'inline' || sourcemap === 'hidden',
    minify,
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

  console.log(
    `  Bundling done in ${bundleDuration}ms (${output.length} chunks)`,
  );

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

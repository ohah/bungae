/**
 * Convert parsed CLI args into a BungaeConfig object.
 *
 * Separated from main.ts so it can be tested without CLI side effects.
 */

import { resolve } from 'path';

import type { BungaeConfig } from '../src/config/types';
import type { ParsedArgs } from './parse-args';
import { parseKeyValuePairs } from './parse-args';

export function buildConfigFromArgs(args: ParsedArgs): BungaeConfig {
  const command = args.command;

  // Handle mode option
  let mode: 'development' | 'production' | undefined;
  let dev: boolean | undefined;
  let minify: boolean | undefined;

  if (args.mode) {
    const modeValue = args.mode.toLowerCase();
    if (modeValue === 'release') {
      mode = 'production';
      dev = false;
      minify = true;
    } else if (modeValue === 'production') {
      mode = 'production';
      dev = false;
      minify = args.minify;
    } else if (modeValue === 'development') {
      mode = 'development';
      dev = true;
      minify = false;
    } else {
      throw new Error(
        `Invalid mode: ${args.mode}. Must be one of: development, production, release`,
      );
    }
  } else {
    dev =
      args.dev !== undefined
        ? args.dev
        : command === 'serve' || command === 'start'
          ? true
          : command === 'build'
            ? false
            : undefined;
    minify = args.minify;
  }

  // Build server config from CLI args
  const serverConfig: BungaeConfig['server'] = {};
  if (args.host !== undefined) serverConfig.host = args.host;
  if (args.port !== undefined) serverConfig.port = args.port;
  if (args.https !== undefined) serverConfig.https = args.https;
  if (args.key !== undefined) serverConfig.key = args.key;
  if (args.cert !== undefined) serverConfig.cert = args.cert;

  const hasServerConfig = Object.keys(serverConfig).length > 0;

  // Build resolver config from CLI args
  const resolverConfig: BungaeConfig['resolver'] = {};
  if (args.sourceExts) {
    resolverConfig.sourceExts = args.sourceExts.map((ext) =>
      ext.startsWith('.') ? ext : `.${ext}`,
    );
  }
  if (args.watchFolders) {
    resolverConfig.nodeModulesPaths = args.watchFolders;
  }
  const hasResolverConfig = Object.keys(resolverConfig).length > 0;

  return {
    root: args.root ? resolve(args.root) : undefined,
    platform: args.platform as BungaeConfig['platform'],
    dev,
    minify,
    mode,
    entry: args.entry,
    outDir: args.outDir,
    bundler: args.bundler as BungaeConfig['bundler'],

    // Build output options
    bundleOutput: args.bundleOutput,
    sourcemapOutput: args.sourcemapOutput,
    sourcemapSourcesRoot: args.sourcemapSourcesRoot,
    sourcemapUseAbsolutePath: args.sourcemapUseAbsolutePath,
    sourceMap: args.sourcemap,
    sourceMapUrl: args.sourceMapUrl,
    assetsDest: args.assetsDest,
    assetCatalogDest: args.assetCatalogDest,
    bundleEncoding: args.bundleEncoding as BufferEncoding | undefined,
    resetCache: args.resetCache,
    maxWorkers: args.maxWorkers,
    watchFolders: args.watchFolders,
    sourceExts: args.sourceExts,
    unstableTransformProfile:
      args.unstableTransformProfile as BungaeConfig['unstableTransformProfile'],
    interactive: args.interactive,
    transformOptions: args.transformOption ? parseKeyValuePairs(args.transformOption) : undefined,
    resolverOptions: args.resolverOption ? parseKeyValuePairs(args.resolverOption) : undefined,

    // Nested configs
    server: hasServerConfig ? serverConfig : undefined,
    resolver: hasResolverConfig ? resolverConfig : undefined,
  };
}

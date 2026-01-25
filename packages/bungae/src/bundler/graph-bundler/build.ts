/**
 * Build bundle using graph bundler
 */

import { resolve } from 'path';

import type { ResolvedConfig } from '../../config/types';
import { baseJSBundle, getPrependedModules } from '../../serializer/baseJSBundle';
import type { SerializerOptions } from '../../serializer/types';
import { createModuleIdFactory, getRunModuleStatement } from '../../serializer/utils';
import { buildGraph, graphToSerializerModules, reorderGraph } from './graph';
import type { BuildOptions, BuildResult } from './types';

/**
 * Build bundle with dependency graph
 */
export async function buildWithGraph(
  config: ResolvedConfig,
  onProgress?: (processed: number, total: number) => void,
  options?: BuildOptions,
): Promise<BuildResult> {
  const { entry, root, dev, platform } = config;
  const entryPath = resolve(root, entry);

  // Build dependency graph with progress tracking
  const graph = await buildGraph(entryPath, config, onProgress);

  // Reorder graph modules in DFS order (Metro-compatible)
  const orderedModules = reorderGraph(graph, entryPath);

  // Convert graph modules to serializer modules
  const serializerModules = await graphToSerializerModules(orderedModules, config);

  // Create module ID factory (Metro-compatible: numeric IDs)
  const createModuleId = createModuleIdFactory();

  // Get runBeforeMainModule modules (Metro-compatible)
  const runBeforeMainModule =
    config.serializer?.getModulesRunBeforeMainModule?.(entryPath, {
      projectRoot: root,
      nodeModulesPaths: config.resolver.nodeModulesPaths || [],
    }) || [];

  // Get serializer options
  const serializerOptions: SerializerOptions = {
    createModuleId,
    getRunModuleStatement, // Metro-compatible: __r() always uses no prefix, only __d() uses the prefix
    dev,
    projectRoot: root,
    serverRoot: root,
    globalPrefix: '__d',
    runModule: options?.runModule ?? true,
    sourceMapUrl: options?.sourcePaths === 'url-server' ? undefined : undefined, // TODO: implement source map URL
    sourceUrl: options?.sourcePaths === 'url-server' ? undefined : undefined, // TODO: implement source URL
    runBeforeMainModule,
    inlineSourceMap: config.serializer?.inlineSourceMap ?? false,
    modulesOnly: options?.modulesOnly ?? false,
    includeAsyncPaths: false,
    getSourceUrl: (module) => {
      if (options?.sourcePaths === 'url-server') {
        // Return server URL for source
        return `http://localhost:${config.server?.port ?? 8081}/source?path=${encodeURIComponent(module.path)}`;
      }
      // Return absolute path
      return module.path;
    },
  };

  // Get prepended modules (prelude, metro-runtime, polyfills)
  const preModules = getPrependedModules({
    dev,
    globalPrefix: serializerOptions.globalPrefix,
    requireCycleIgnorePatterns: [], // TODO: add to config if needed
    polyfills: config.serializer?.polyfills,
    projectRoot: root,
  });

  // Create bundle
  const bundle = await baseJSBundle(entryPath, preModules, serializerModules, serializerOptions);

  // Combine bundle code
  const bundleCode =
    bundle.pre + '\n' + bundle.modules.map(([_, code]) => code).join('\n') + '\n' + bundle.post;

  // Extract assets from graph (for Metro-compatible asset handling)
  const assets = extractAssetsFromGraph(graph);

  return {
    code: bundleCode,
    map: undefined, // TODO: combine source maps
    assets,
    // HMR support (dev mode only)
    graph: dev ? graph : undefined,
    createModuleId: dev ? createModuleId : undefined,
  };
}

/**
 * Extract asset information from graph
 */
function extractAssetsFromGraph(graph: Map<string, any>): any[] {
  const assets: any[] = [];
  // TODO: implement asset extraction from graph
  return assets;
}

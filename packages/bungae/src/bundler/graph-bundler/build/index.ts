/**
 * Build function for Graph Bundler
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import type { ResolvedConfig } from '../../../config/types';
import {
  baseJSBundle,
  getPrependedModules,
  createModuleIdFactory,
  getRunModuleStatement,
} from '../../../serializer';
import { buildGraph, reorderGraph, graphToSerializerModules } from '../graph';
import { minifyCode } from '../minify';
import { applyTreeShaking } from '../tree-shaking';
import type { BuildResult } from '../types';
import { extractAssets } from './assets';
import { generateSourceMap } from './sourcemap';
import { buildSourceRequestRoutingMap, createGetSourceUrl } from './utils';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Build bundle using Graph + Metro module system
 */
export interface BuildOptions {
  /** Exclude source code from source map (Metro-compatible) */
  excludeSource?: boolean;
  /** Return modules only, skip prelude and runtime (Metro-compatible) */
  modulesOnly?: boolean;
  /** Run module after loading (Metro-compatible) */
  runModule?: boolean;
  /** Bundle name for source map folder structure (e.g., 'index.bundle') */
  bundleName?: string;
  /** Source paths mode: 'absolute' or 'url-server' (Metro-compatible) */
  sourcePaths?: 'absolute' | 'url-server';
}

export async function buildWithGraph(
  config: ResolvedConfig,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
  options?: BuildOptions,
): Promise<BuildResult> {
  const {
    excludeSource = false,
    modulesOnly = false,
    runModule = true,
    bundleName,
    sourcePaths = 'url-server', // Default to url-server for Metro compatibility
  } = options || {};
  const { entry, dev, root } = config;

  const entryPath = resolve(root, entry);
  if (!existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  console.log(`Building dependency graph (Babel + Metro-compatible)...`);

  // Get modules to run before main module (Metro-compatible)
  // This needs to be done before building graph to ensure these modules are included
  // Pass nodeModulesPaths for monorepo support (Metro-compatible)
  let runBeforeMainModule: string[] = [];
  if (config.serializer?.getModulesRunBeforeMainModule) {
    try {
      runBeforeMainModule = config.serializer.getModulesRunBeforeMainModule(entryPath, {
        projectRoot: root,
        nodeModulesPaths: config.resolver.nodeModulesPaths,
      });
      if (dev && runBeforeMainModule.length > 0) {
        console.log(`Modules to run before main: ${runBeforeMainModule.join(', ')}`);
      }
    } catch (error) {
      if (dev) {
        console.warn(`Error calling getModulesRunBeforeMainModule: ${error}`);
      }
    }
  }

  // Build dependency graph
  const startTime = Date.now();
  let lastTerminalProgress = -1;
  const graph = await buildGraph(entryPath, config, (processed, total) => {
    // Metro-style terminal output: "Transforming (45.2%)"
    const percentage = total > 0 ? (processed / total) * 100 : 0;
    const roundedPercentage = Math.floor(percentage);

    // Update terminal every 1% or when complete
    if (roundedPercentage > lastTerminalProgress || processed === total) {
      process.stdout.write(
        `\r\x1b[K info Transforming (${percentage.toFixed(1)}%) (${processed}/${total} files)`,
      );
      lastTerminalProgress = roundedPercentage;
    }

    // Call onProgress callback for multipart streaming (every call, no throttle here)
    // Throttling is done in the server's multipart handler
    onProgress?.(processed, total);
  });
  console.log(
    `\r\x1b[K info Transforming done in ${Date.now() - startTime}ms (${graph.size} modules)`,
  );

  // Metro behavior: Metro assumes runBeforeMainModule modules are already in the dependency graph.
  // Check if InitializeCore is in the graph and log debug info if not found.
  if (dev && runBeforeMainModule.length > 0) {
    for (const modulePath of runBeforeMainModule) {
      const found = graph.has(modulePath);
      if (!found) {
        // Check if any module in graph matches InitializeCore by path segments
        const matchingModules = Array.from(graph.keys()).filter((path) =>
          path.includes('InitializeCore'),
        );
        console.warn(`InitializeCore not found in dependency graph. Expected: ${modulePath}`);
        if (matchingModules.length > 0) {
          console.warn(`Found similar modules in graph: ${matchingModules.join(', ')}`);
        } else {
          console.warn(
            `No InitializeCore-related modules found in dependency graph. Graph size: ${graph.size}`,
          );
          // Debug: Check if react-native is in the graph
          const reactNativeModules = Array.from(graph.keys()).filter((path) =>
            path.includes('react-native'),
          );
          if (reactNativeModules.length > 0) {
            console.warn(
              `Found react-native modules in graph (${reactNativeModules.length}): ${reactNativeModules.slice(0, 5).join(', ')}...`,
            );
          } else {
            console.warn(`No react-native modules found in dependency graph!`);
          }
        }
      }
    }
  }

  // Apply tree shaking if enabled (production builds only)
  let finalGraph = graph;
  if (config.experimental.treeShaking && !dev) {
    console.log('Applying tree shaking...');
    const treeShakingStartTime = Date.now();
    finalGraph = await applyTreeShaking(graph, entryPath);
    const removedModules = graph.size - finalGraph.size;
    if (removedModules > 0) {
      console.log(
        `Tree shaking removed ${removedModules} unused module(s) in ${Date.now() - treeShakingStartTime}ms`,
      );
    } else {
      console.log(`Tree shaking completed in ${Date.now() - treeShakingStartTime}ms (no unused modules found)`);
    }
  }

  // Reorder graph modules in DFS order (Metro-compatible)
  // This ensures module ID assignment matches Metro's behavior
  const orderedGraphModules = reorderGraph(finalGraph, entryPath);
  if (dev) {
    console.log(`Reordered ${orderedGraphModules.length} modules in DFS order (Metro-compatible)`);
  }

  // Convert to serializer modules (now using ordered array)
  // Pass config to filter out dev-only modules in production builds
  const graphModules = await graphToSerializerModules(orderedGraphModules, config);

  // Read Bungae version from package.json
  let bungaeVersion = '0.0.1';
  try {
    const packageJsonPath = resolve(__dirname, '../../../../package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      bungaeVersion = packageJson.version || '0.0.1';
    }
  } catch {
    // Fallback to default version if package.json cannot be read
  }

  // Merge extraVars with Bungae identifiers
  const extraVars = {
    ...config.serializer?.extraVars,
    __BUNGAE_BUNDLER__: true,
    __BUNGAE_VERSION__: bungaeVersion,
  };

  // Get prepended modules (prelude, metro-runtime, polyfills)
  const prependModules = getPrependedModules({
    dev,
    globalPrefix: '',
    polyfills: config.serializer?.polyfills || [],
    extraVars,
    requireCycleIgnorePatterns: [/(^|\/|\\)node_modules($|\/|\\)/],
    projectRoot: root,
  });

  // Create module ID factory
  const createModuleId = createModuleIdFactory();

  // Metro-compatible: Build source request routing map for getSourceUrl
  // This ensures verboseName matches source map sources path for console logs
  const sourceRequestRoutingMap = buildSourceRequestRoutingMap(config);
  const getSourceUrl = createGetSourceUrl(config, sourceRequestRoutingMap);

  // Serialize bundle
  const bundle = await baseJSBundle(entryPath, prependModules, graphModules, {
    createModuleId,
    getRunModuleStatement,
    dev,
    projectRoot: root,
    serverRoot: root,
    globalPrefix: '',
    runModule,
    modulesOnly,
    runBeforeMainModule,
    inlineSourceMap: config.serializer?.inlineSourceMap ?? false,
    getSourceUrl: (module) => getSourceUrl(module.path),
  });

  // Combine bundle parts
  let code = [
    '// Bungae Bundle (Graph Mode)',
    bundle.pre,
    bundle.modules.map(([, code]) => code).join('\n'),
    bundle.post,
  ].join('\n');

  // Create reverse mapping: moduleId -> module path from graphModules
  // This is needed for source map generation
  const moduleIdToPath = new Map<number | string, string>();
  for (const module of graphModules) {
    const moduleId = createModuleId(module.path);
    moduleIdToPath.set(moduleId, module.path);
  }

  // Build a lookup map from module path to serializer module to avoid repeated linear scans
  // This optimizes O(n²) to O(n) when processing bundle.modules
  const graphModuleByPath = new Map<string, (typeof graphModules)[number]>();
  for (const m of graphModules) {
    graphModuleByPath.set(m.path, m);
  }

  // Generate source map (dev mode only) - Metro-compatible using metro-source-map
  let map: string | undefined;
  if (dev) {
    map = await generateSourceMap({
      config,
      bundle,
      bundleName,
      excludeSource,
      sourcePaths,
      moduleIdToPath,
      graphModuleByPath,
      graph: finalGraph,
    });
  }

  // Apply minification if enabled (production builds)
  if (config.minify && !dev) {
    console.log('Minifying bundle...');
    const minifyStartTime = Date.now();
    try {
      const minifyResult = await minifyCode(code, {
        minifier: config.transformer.minifier,
        sourceMap: map,
        fileName: bundleName || 'bundle.js',
      });
      code = minifyResult.code;
      if (minifyResult.map) {
        map = minifyResult.map;
      }
      console.log(`Minification completed in ${Date.now() - minifyStartTime}ms`);
    } catch (error) {
      console.warn('Minification failed, using unminified code:', error);
      // Continue with unminified code
    }
  }

  // Handle inlineSourceMap option
  // For inline source maps: add base64-encoded source map inline
  // For non-inline source maps: add relative path sourceMappingURL (server.ts will add full URL when serving)
  const inlineSourceMap = config.serializer?.inlineSourceMap ?? false;
  let finalCode = code;
  let finalMap = map;

  if (inlineSourceMap && map) {
    // Encode source map as base64 and add inline source map comment
    const base64Map = Buffer.from(map).toString('base64');
    const inlineSourceMapComment = `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64Map}`;
    finalCode = code + inlineSourceMapComment;
    finalMap = undefined; // Don't return separate map file when inline
  } else if (map) {
    // For non-inline source maps, DON'T add sourceMappingURL here
    // server.ts will add the full URL when serving via HTTP
    // This prevents duplicate/conflicting sourceMappingURL comments
    // For file-based builds (build command), the caller should add the URL
    finalCode = code;
  }

  // Extract asset files from bundle modules (only assets actually included in bundle)
  const assets = extractAssets({
    config,
    bundle,
    moduleIdToPath,
    graph: finalGraph,
  });

  return { code: finalCode, map: finalMap, assets, graph: finalGraph, createModuleId };
}

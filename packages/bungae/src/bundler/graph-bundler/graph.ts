/**
 * Dependency graph building and traversal for Graph Bundler
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { ResolvedConfig } from '../../config/types';
import type { Module } from '../../serializer/types';
import { extractDependenciesFromAst } from '../../transformer/extract-dependencies-from-ast';
import { PersistentCache } from './cache';
import { resolveModule } from './resolver';
import { transformFile } from './transformer';
import type { GraphModule } from './types';
import { generateAssetModuleCode } from './utils';

/**
 * Build dependency graph from entry point
 */
export async function buildGraph(
  entryPath: string,
  config: ResolvedConfig,
  onProgress?: (processed: number, total: number) => void,
): Promise<Map<string, GraphModule>> {
  const modules = new Map<string, GraphModule>();
  const visited = new Set<string>();
  const processing = new Set<string>();

  // Initialize persistent cache
  // Use .bungae-cache to avoid conflict with outDir (which may be .bungae)
  const cacheDir = join(config.root, '.bungae-cache');
  const cache = new PersistentCache({ cacheDir });

  // Metro-compatible progress tracking
  // Metro uses numProcessed and total, calling onProgress twice per module:
  // 1. onDependencyAdd: when dependency is discovered (total++ before transform)
  // 2. onDependencyAdded: when dependency is processed (numProcessed++ after transform)
  let numProcessed = 0;
  let total = 0;

  // Metro's onDependencyAdd and onDependencyAdded pattern
  const onDependencyAdd = () => {
    if (onProgress) {
      onProgress(numProcessed, ++total);
    }
  };

  const onDependencyAdded = () => {
    if (onProgress) {
      onProgress(++numProcessed, total);
    }
  };

  async function processModule(filePath: string): Promise<void> {
    if (visited.has(filePath) || processing.has(filePath)) {
      return;
    }

    processing.add(filePath);

    // Skip Flow files
    if (filePath.endsWith('.flow.js') || filePath.endsWith('.flow')) {
      visited.add(filePath);
      processing.delete(filePath);
      // Metro: still count skipped files for progress
      onDependencyAdd();
      onDependencyAdded();
      return;
    }

    // Handle asset files (images, etc.) - generate AssetRegistry module
    // assetExts already include the dot (e.g., '.png', '.jpg')
    const isAsset = config.resolver.assetExts.some((ext) => {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      return filePath.endsWith(normalizedExt);
    });
    if (isAsset) {
      // Metro: onDependencyAdd when asset is discovered
      onDependencyAdd();

      // Resolve AssetRegistry dependency
      const assetRegistryPath = 'react-native/Libraries/Image/AssetRegistry';
      let resolvedAssetRegistry: string | null = null;
      try {
        resolvedAssetRegistry = require.resolve(assetRegistryPath, {
          paths: [config.root, ...config.resolver.nodeModulesPaths],
        });
      } catch {
        // AssetRegistry not found, skip asset processing
        console.warn(`AssetRegistry not found, skipping asset: ${filePath}`);
        visited.add(filePath);
        processing.delete(filePath);
        // Metro: still count skipped files for progress
        onDependencyAdded();
        return;
      }

      const assetCode = generateAssetModuleCode(filePath, config.root);

      // Parse asset code to AST (simple module.exports assignment)
      const babel = await import('@babel/core');
      const assetAst = await babel.parseAsync(assetCode, {
        filename: filePath,
        sourceType: 'module',
      });
      // Extract dependencies from asset AST (should include AssetRegistry)
      const assetDeps = await extractDependenciesFromAst(assetAst);
      const module: GraphModule = {
        path: filePath,
        code: assetCode,
        transformedAst: assetAst,
        dependencies: resolvedAssetRegistry ? [resolvedAssetRegistry] : [],
        originalDependencies: assetDeps.length > 0 ? assetDeps : [assetRegistryPath],
      };
      modules.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);

      // Metro: onDependencyAdded when asset is processed
      onDependencyAdded();

      // Process AssetRegistry dependency if not already processed
      if (
        resolvedAssetRegistry &&
        !visited.has(resolvedAssetRegistry) &&
        !processing.has(resolvedAssetRegistry)
      ) {
        await processModule(resolvedAssetRegistry);
      }
      return;
    }

    // Read file
    const code = readFileSync(filePath, 'utf-8');

    // Check cache first (skip for assets and JSON files)
    const isJSON = filePath.endsWith('.json');
    let transformResult: { ast: any; sourceMap?: string } | null = null;
    let cachedDependencies: string[] | null = null;

    if (!isJSON && !isAsset) {
      const cacheEntry = cache.get(filePath, {
        platform: config.platform,
        dev: config.dev,
        root: config.root,
        inlineRequires: config.transformer.inlineRequires,
      });

      if (cacheEntry) {
        // Use cached transformation result
        // Note: AST is not cached (too large), so we still need to transform
        // But we can use cached dependencies to skip dependency extraction
        // Cache stores unresolved dependencies (original specifiers like 'react' or './utils')
        cachedDependencies = cacheEntry.dependencies;
      }
    }

    // JSON files: No dependencies, just wrap as module
    if (isJSON) {
      // Metro: onDependencyAdd when JSON file is discovered
      onDependencyAdd();

      transformResult = await transformFile(filePath, code, config, entryPath);
      const module: GraphModule = {
        path: filePath,
        code,
        transformedAst: transformResult?.ast || null,
        dependencies: [],
        originalDependencies: [],
        sourceMap: transformResult?.sourceMap,
      };
      modules.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);

      // Metro: onDependencyAdded when JSON file is processed
      onDependencyAdded();
      return;
    }

    // Metro: onDependencyAdd when module is discovered (before transform)
    onDependencyAdd();

    // Transform code (returns AST only, Metro-compatible)
    transformResult = await transformFile(filePath, code, config, entryPath);
    if (!transformResult) {
      // Flow file or other skipped file
      visited.add(filePath);
      processing.delete(filePath);
      // Metro: still count skipped files for progress
      onDependencyAdded();
      return;
    }

    // Metro-compatible: Extract dependencies from transformed AST only (no code generation)
    // Metro uses collectDependencies on transformed AST - type-only imports are handled by Babel preset
    // Babel may add new imports (e.g., react/jsx-runtime for JSX) which will be in the transformed AST
    let allDeps: string[] = [];
    if (cachedDependencies) {
      // Use cached dependencies (but still need to resolve them)
      allDeps = cachedDependencies;
    } else {
      // Extract dependencies from AST
      allDeps = await extractDependenciesFromAst(transformResult.ast);
    }

    // Resolve dependencies (including asset files)
    const resolvedDependencies: string[] = [];
    const originalDependencies: string[] = [];

    for (const dep of allDeps) {
      if (!dep || !dep.trim()) continue;

      const resolved = await resolveModule(filePath, dep, config);
      if (resolved) {
        resolvedDependencies.push(resolved);
        originalDependencies.push(dep);
      } else if (config.dev) {
        console.warn(`Failed to resolve "${dep}" from ${filePath}`);
      }
    }

    // Cache transformation result (without AST to save space)
    // Store unresolved dependencies (allDeps) not resolved ones, so cache can be reused
    if (!isJSON && !isAsset) {
      cache.set(
        filePath,
        {
          platform: config.platform,
          dev: config.dev,
          root: config.root,
          inlineRequires: config.transformer.inlineRequires,
        },
        {
          code,
          dependencies: allDeps, // Store unresolved dependencies, not resolved ones
          sourceMap: transformResult.sourceMap,
          timestamp: Date.now(),
        },
      );
    }

    // Create module (store AST, serializer will generate code)
    const module: GraphModule = {
      path: filePath,
      code,
      transformedAst: transformResult.ast,
      dependencies: resolvedDependencies,
      originalDependencies,
      sourceMap: transformResult.sourceMap,
    };

    modules.set(filePath, module);
    visited.add(filePath);

    // Process dependencies FIRST (before onDependencyAdded)
    // This ensures that when onDependencyAdded is called, dependencies are already being processed
    // which means total > numProcessed, giving us proper progress (e.g., 1/3, 2/3, 3/3)
    for (const dep of resolvedDependencies) {
      if (!visited.has(dep) && !processing.has(dep)) {
        await processModule(dep);
      }
    }

    // Metro: onDependencyAdded when module is processed (after transform, dependency resolution, AND dependency processing)
    // This is called after dependencies are processed, so numProcessed can catch up to total
    onDependencyAdded();

    processing.delete(filePath);
  }

  await processModule(entryPath);

  // Note: ReactNativePrivateInitializeCore and InitializeCore should be automatically
  // included in the dependency graph when react-native is imported (via dependency traversal).
  // Metro does not manually add them - they are found through normal dependency resolution.
  // The serializer (baseJSBundle.ts) will find them in the graph and add to runBeforeMainModule.

  // Build inverse dependencies for efficient HMR (Metro-compatible)
  buildInverseDependencies(modules);

  return modules;
}

/**
 * Reorder graph modules in DFS order (Metro-compatible)
 * Metro uses reorderGraph to ensure modules are in DFS traversal order
 * This ensures consistent module ID assignment matching Metro's behavior
 *
 * Metro uses post-order DFS: dependencies are visited first, then parent module
 * This means dependencies get lower module IDs than their parents
 */
export function reorderGraph(graph: Map<string, GraphModule>, entryPath: string): GraphModule[] {
  const ordered: GraphModule[] = [];
  const visited = new Set<string>();

  function visitModule(modulePath: string): void {
    if (visited.has(modulePath)) {
      return;
    }

    const module = graph.get(modulePath);
    if (!module) {
      return;
    }

    visited.add(modulePath);

    // Visit dependencies first (post-order DFS)
    // Metro processes dependencies in the order they appear in the dependencies array
    // Dependencies are added to the ordered list before their parent module
    for (const dep of module.dependencies) {
      if (graph.has(dep) && !visited.has(dep)) {
        visitModule(dep);
      }
    }

    // Add module to ordered list after visiting all dependencies (post-order)
    // This ensures dependencies get lower module IDs than their parents
    ordered.push(module);
  }

  // Start DFS from entry point
  if (graph.has(entryPath)) {
    visitModule(entryPath);
  }

  // Handle any remaining modules that weren't reachable from entry
  // (shouldn't happen in normal cases, but for safety)
  for (const [path] of graph.entries()) {
    if (!visited.has(path)) {
      visitModule(path);
    }
  }

  return ordered;
}

/**
 * Build inverse dependencies for all modules in the graph (Metro-compatible)
 * This is called after building the graph to cache inverse dependencies for efficient HMR
 */
export function buildInverseDependencies(graph: Map<string, GraphModule>): void {
  // Initialize inverse dependencies arrays
  for (const [, module] of graph.entries()) {
    module.inverseDependencies = [];
  }

  // Build inverse dependencies: for each module, find all modules that depend on it
  for (const [path, module] of graph.entries()) {
    for (const dep of module.dependencies) {
      const depModule = graph.get(dep);
      if (depModule && depModule.inverseDependencies) {
        // Add this module to the dependency's inverse dependencies
        if (!depModule.inverseDependencies.includes(path)) {
          depModule.inverseDependencies.push(path);
        }
      }
    }
  }
}

/**
 * Convert graph modules to serializer modules
 * Now accepts ordered modules array instead of Map to ensure consistent ordering
 * In production builds, excludes dev-only modules like openURLInBrowser (Metro-compatible)
 */
export async function graphToSerializerModules(
  orderedModules: GraphModule[],
  config: ResolvedConfig,
): Promise<Module[]> {
  const generator = await import('@babel/generator');

  // In production builds, exclude dev-only modules (Metro-compatible)
  // Metro excludes openURLInBrowser and other dev tools in production builds
  const filteredModules = config.dev
    ? orderedModules
    : orderedModules.filter((m) => {
        // Exclude React Native dev tools modules in production
        // These modules are only used in development mode
        const isDevTool =
          m.path.includes('openURLInBrowser') ||
          m.path.includes('Devtools/openURLInBrowser') ||
          m.path.includes('Core/Devtools');
        if (isDevTool) {
          console.log(
            `Excluding dev-only module from production build: ${m.path} (Metro-compatible)`,
          );
          return false;
        }
        return true;
      });

  return Promise.all(
    filteredModules.map(async (m) => {
      // Generate code from AST (Metro-compatible: serializer generates code from AST)
      // @babel/generator can handle File node directly (it uses program property)
      let code = '';
      let sourceMap: string | undefined;

      if (m.transformedAst) {
        // If AST is File node, generator handles it directly
        // If AST is Program node, wrap it in File node for consistency
        const astToGenerate =
          m.transformedAst.type === 'File'
            ? m.transformedAst
            : { type: 'File', program: m.transformedAst, comments: [], tokens: [] };

        // Generate code WITH source maps for DevTools support
        // This is critical for React Native DevTools to show correct source locations
        // IMPORTANT: Pass original source code as 3rd parameter for accurate source map generation
        const generated = generator.default(
          astToGenerate,
          {
            comments: true,
            filename: m.path,
            sourceMaps: config.dev, // Generate source maps in dev mode
            sourceFileName: m.path, // Use full path for source map
          },
          m.code, // Original source code - required for source map generation
        );
        code = generated.code;

        // Include generated source map if available
        if (generated.map && config.dev) {
          sourceMap = JSON.stringify(generated.map);
        }
      } else {
        // Fallback for modules without AST (should not happen)
        code = m.code;
      }

      return {
        path: m.path,
        code,
        dependencies: m.dependencies,
        originalDependencies: m.originalDependencies,
        type: 'js/module' as const,
        map: sourceMap || m.sourceMap, // Use generated source map, fallback to transformer's
      };
    }),
  );
}

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
        transformedAst: assetAst!,
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
    let transformResult: { ast: any } | null = null;
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
          timestamp: Date.now(),
        },
      );
    }

    // Create module (store AST, serializer will generate code + source map)
    // Metro-compatible: Transform phase only stores AST, no source map
    // Source maps are generated later in graphToSerializerModules() using generate()
    const module: GraphModule = {
      path: filePath,
      code,
      transformedAst: transformResult.ast,
      dependencies: resolvedDependencies,
      originalDependencies,
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
 * Wrap AST with __d() call (Metro-compatible)
 * This wraps the program body in a function expression and calls __d() with it.
 * Source: Metro's JsFileWrapping.wrapModule
 *
 * Metro wraps AST with __d(factory) ONLY - no moduleId, dependencies, or verboseName.
 * These are added later by the serializer using addParamsToDefineCall (string manipulation).
 * This ensures source maps remain accurate since addParamsToDefineCall only appends to the end.
 */
function wrapAstWithDefine(
  ast: any,
  t: typeof import('@babel/types'),
  globalPrefix: string = '',
): any {
  // Get program body
  const program = ast.type === 'File' ? ast.program : ast;

  // Build function parameters (Metro-compatible)
  // Metro uses exact parameter names: function(global, _$$_REQUIRE, _$$_IMPORT_DEFAULT, _$$_IMPORT_ALL, module, exports, _dependencyMap)
  // These names are important for stack trace compatibility
  const params = [
    t.identifier('global'),
    t.identifier('_$$_REQUIRE'),
    t.identifier('_$$_IMPORT_DEFAULT'),
    t.identifier('_$$_IMPORT_ALL'),
    t.identifier('module'),
    t.identifier('exports'),
    t.identifier('_dependencyMap'),
  ];

  // Create function expression from program body
  const factory = t.functionExpression(
    undefined, // no name
    params,
    t.blockStatement(program.body, program.directives),
  );

  // Create __d() call with ONLY factory (Metro-compatible)
  // moduleId, dependencies, verboseName are added later by serializer
  const defineCall = t.callExpression(t.identifier(`${globalPrefix}__d`), [factory]);

  // Create new File AST with the __d() call
  return t.file(t.program([t.expressionStatement(defineCall)]));
}

/**
 * Metro-compatible: Count lines and add terminating mapping (countLinesAndTerminateMap)
 * This ensures out-of-bounds lookups hit a null mapping rather than aliasing to wrong source
 *
 * From Metro's metro-transform-worker/src/index.js line 744
 */
function countLinesAndTerminateMap(
  code: string,
  map: ReadonlyArray<
    [number, number] | [number, number, number, number] | [number, number, number, number, string]
  >,
): {
  lineCount: number;
  map: Array<
    [number, number] | [number, number, number, number] | [number, number, number, number, string]
  >;
} {
  // Metro's NEWLINE regex handles all line terminators
  const NEWLINE = /\r\n?|\n|\u2028|\u2029/g;
  let lineCount = 1;
  let lastLineStart = 0;

  // Count lines and keep track of where the last line starts
  for (const match of code.matchAll(NEWLINE)) {
    lineCount++;
    lastLineStart = match.index! + match[0].length;
  }
  const lastLineLength = code.length - lastLineStart;
  const lastLineIndex1Based = lineCount;
  const lastLineNextColumn0Based = lastLineLength;

  // If there isn't a mapping at one-past-the-last column of the last line,
  // add one that maps to nothing. This ensures out-of-bounds lookups hit the
  // null mapping rather than aliasing to whichever mapping happens to be last.
  // ASSUMPTION: Mappings are generated in order of increasing line and column.
  const lastMapping = map[map.length - 1];
  const terminatingMapping: [number, number] = [lastLineIndex1Based, lastLineNextColumn0Based];
  if (
    !lastMapping ||
    lastMapping[0] !== terminatingMapping[0] ||
    lastMapping[1] !== terminatingMapping[1]
  ) {
    return {
      lineCount,
      map: [...map, terminatingMapping],
    };
  }
  return { lineCount, map: [...map] };
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
  const babelTypes = await import('@babel/types');
  // Import metro-source-map utilities for Metro-compatible source map generation
  const metroSourceMap = await import('metro-source-map');
  const { toSegmentTuple } = metroSourceMap;

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
      // Metro-compatible: Generate code + source map from AST (like Metro's transformJS)
      // Metro's transformJS uses generate() with sourceMaps: true to create source map
      // This is the correct way to generate source maps: AST → code + source map
      // The source map maps from generated code back to original source code
      let code = '';
      let sourceMap: string | undefined;

      if (m.transformedAst) {
        // If AST is File node, generator handles it directly
        // If AST is Program node, wrap it in File node for consistency
        let astToGenerate = m.transformedAst;

        // Metro-compatible: Wrap AST with __d() BEFORE code generation
        // This ensures source maps are for the wrapped code, not unwrapped code
        // Metro's JsFileWrapping.wrapModule does this in the transformer
        // The moduleId, dependencies, and verboseName are added later by serializer
        astToGenerate = wrapAstWithDefine(astToGenerate, babelTypes);

        // Metro-compatible: Generate code + source map from WRAPPED AST
        // Metro's transformJS (line 461-474) uses generate() with sourceMaps: true
        // Then converts rawMappings to Metro format using toSegmentTuple
        // This ensures accurate source mapping: original code → transformed AST → wrapped code
        const generated = generator.default(
          astToGenerate,
          {
            comments: true,
            filename: m.path,
            sourceMaps: config.dev, // Generate source map in dev mode (Metro-compatible)
            sourceFileName: m.path, // Use full path for source map
          },
          m.code, // Original source code - required for accurate source map generation
        );
        code = generated.code;

        // Metro-compatible: Use rawMappings directly (like Metro's transformJS line 474)
        // Metro uses: result.rawMappings ? result.rawMappings.map(toSegmentTuple) : []
        // rawMappings is an array of BabelSourceMapSegment objects with { generated, original, name }
        // toSegmentTuple converts them to Metro format: [line, column, sourceLine, sourceColumn, name?]
        // Note: rawMappings is not in TypeScript types but is available at runtime
        const generatedWithRawMappings = generated as typeof generated & { rawMappings?: any[] };
        if (config.dev && generatedWithRawMappings.rawMappings) {
          // Convert rawMappings to Metro format using toSegmentTuple (Metro-compatible)
          const metroMappings = generatedWithRawMappings.rawMappings.map((mapping: any) =>
            toSegmentTuple(mapping),
          );
          // Metro-compatible: Add terminating mapping using countLinesAndTerminateMap
          // This ensures out-of-bounds lookups hit null mapping (Metro's transformJS line 482)
          const { lineCount, map: terminatedMap } = countLinesAndTerminateMap(code, metroMappings);
          // Store as JSON with rawMappings and lineCount so generateSourceMap uses them directly
          sourceMap = JSON.stringify({ rawMappings: terminatedMap, lineCount });
        } else if (config.dev && generated.map) {
          // Fallback: Store Babel source map if rawMappings not available
          sourceMap = JSON.stringify(generated.map);
        }
      } else {
        // Fallback for modules without AST (should not happen)
        code = m.code;
        // No source map for modules without AST
        sourceMap = undefined;
      }

      return {
        path: m.path,
        code,
        dependencies: m.dependencies,
        originalDependencies: m.originalDependencies,
        type: 'js/module' as const,
        map: sourceMap, // Source map from AST → code generation (Metro-compatible)
      };
    }),
  );
}

/**
 * Source map generation for Graph Bundler
 */

import { readFileSync } from 'fs';
import { relative } from 'path';
import type { ResolvedConfig } from '../../../config/types';
import type { Module } from '../../../serializer/types';
import type { GraphModule } from '../types';
import { createGetSourceUrl, buildSourceRequestRoutingMap } from './utils';

export interface GenerateSourceMapOptions {
  config: ResolvedConfig;
  bundle: {
    pre: string;
    modules: Array<[number | string, string]>;
  };
  bundleName?: string;
  excludeSource: boolean;
  sourcePaths: 'absolute' | 'url-server';
  moduleIdToPath: Map<number | string, string>;
  graphModuleByPath: Map<string, Module>;
  graph: Map<string, GraphModule>;
}

/**
 * Generate source map for bundle (dev mode only)
 * Metro-compatible using metro-source-map
 */
export async function generateSourceMap(
  options: GenerateSourceMapOptions,
): Promise<string | undefined> {
  const {
    config,
    bundle,
    bundleName,
    excludeSource,
    sourcePaths,
    moduleIdToPath,
    graphModuleByPath,
    graph,
  } = options;

  const { dev } = config;

  // Only generate source map in dev mode
  if (!dev) {
    return undefined;
  }

  try {
    // Use metro-source-map API (Metro-compatible)
    const metroSourceMap = await import('metro-source-map');
    const { toBabelSegments, toSegmentTuple, fromRawMappings, generateFunctionMap } =
      metroSourceMap;

    // Combine prelude with bundle header comment for accurate line counting
    // This matches the actual bundle structure: header + prelude + modules + post
    const preludeWithHeader = '// Bungae Bundle (Graph Mode)\n' + bundle.pre;
    const preLines = preludeWithHeader.split('\n').length;

    // Prepare modules for fromRawMappings (Metro-compatible format)
    const metroModules: Array<{
      map: Array<
        | [number, number]
        | [number, number, number, number]
        | [number, number, number, number, string]
      > | null;
      functionMap: any;
      path: string;
      source: string;
      code: string;
      isIgnored: boolean;
      lineCount?: number;
    }> = [];

    // Metro-compatible: Add __prelude__ as the first source (like Metro does)
    // This represents the prelude/runtime code at the beginning of the bundle
    // IMPORTANT: Use empty array [] for map, not null - Metro uses [] for prelude
    // Metro uses folder structure like 'index.bundle/__prelude__' for DevTools
    const bundlePrefix = bundleName ? `${bundleName}/` : '';
    metroModules.push({
      map: [], // Empty array, not null - Metro-compatible
      functionMap: null,
      path: `${bundlePrefix}__prelude__`,
      source: preludeWithHeader,
      code: preludeWithHeader,
      isIgnored: false,
      lineCount: preLines,
    });

    // Metro-compatible source map folder structure
    // Use the same sourceRequestRoutingMap and getSourceUrl from above
    // This ensures source map sources path matches verboseName
    const sourceRequestRoutingMap = buildSourceRequestRoutingMap(config);
    const getSourceUrl = createGetSourceUrl(config, sourceRequestRoutingMap);

    // Process each module in the bundle
    for (const [moduleId, moduleCode] of bundle.modules) {
      const modulePath = moduleIdToPath.get(moduleId);
      if (!modulePath) continue;

      // Find the module in serializer modules to get its source map
      const serializerModule = graphModuleByPath.get(modulePath);

      // Metro-compatible: verboseName is ALWAYS a relative path (e.g., "App.tsx")
      // For sourcePaths=url-server, Metro uses getSourceUrl for source map sources (e.g., "[metro-project]/App.tsx")
      // React Native matches verboseName (relative) to source map sources by normalizing paths
      // Metro's behavior: verboseName="App.tsx", source map sources="[metro-project]/App.tsx"
      // React Native normalizes "[metro-project]/App.tsx" to "App.tsx" for matching
      const relativeModulePath = relative(config.root, modulePath).replace(/\\/g, '/');
      // Use getSourceUrl format for source map sources when sourcePaths=url-server (Metro-compatible)
      // This matches Metro's behavior exactly
      const sourceMapPath =
        sourcePaths === 'url-server'
          ? getSourceUrl(modulePath) // Use [metro-project]/App.tsx format (Metro-compatible)
          : relativeModulePath; // Use relative path for absolute mode

      // Read original source code
      let sourceCode: string;
      try {
        sourceCode = readFileSync(modulePath, 'utf-8');
      } catch {
        sourceCode = serializerModule?.code || '';
      }

      // Convert Babel source map to raw mappings (Metro format)
      let rawMappings: Array<
        | [number, number]
        | [number, number, number, number]
        | [number, number, number, number, string]
      > | null = null;
      let functionMap: any = null;

      if (serializerModule?.map) {
        try {
          const babelSourceMap = JSON.parse(serializerModule.map);
          // Convert Babel source map to raw mappings using toBabelSegments and toSegmentTuple
          const babelSegments = toBabelSegments(babelSourceMap);
          rawMappings = babelSegments.map(toSegmentTuple);
        } catch {
          // If conversion fails, create basic line-by-line mappings
          // Metro includes modules even without source maps
          const moduleLines = moduleCode.split('\n').length;
          rawMappings = [];
          for (let i = 0; i < moduleLines; i++) {
            rawMappings.push([i + 1, 0, i + 1, 0]);
          }
        }
      } else {
        // No source map - create basic line-by-line mappings (Metro-compatible)
        const moduleLines = moduleCode.split('\n').length;
        rawMappings = [];
        for (let i = 0; i < moduleLines; i++) {
          // [generatedLine, generatedColumn, sourceLine, sourceColumn]
          rawMappings.push([i + 1, 0, i + 1, 0]);
        }
      }

      // Generate function map from AST (Metro-compatible)
      // Find the GraphModule to get transformedAst
      const graphModuleForAst = graph.get(modulePath);
      if (graphModuleForAst?.transformedAst) {
        try {
          // Ensure AST is in File node format (Metro-compatible)
          // Babel 7+ returns File node, but we need to ensure it has the correct structure
          let astForFunctionMap = graphModuleForAst.transformedAst;

          // If AST is not a File node, wrap it in a File node
          if (!astForFunctionMap || astForFunctionMap.type !== 'File') {
            // If it's a Program node, wrap it
            if (astForFunctionMap?.type === 'Program') {
              astForFunctionMap = {
                type: 'File',
                program: astForFunctionMap,
                comments: astForFunctionMap.comments || [],
                tokens: astForFunctionMap.tokens || [],
              };
            } else {
              // Invalid AST structure, skip function map generation
              astForFunctionMap = null;
            }
          }

          // Ensure File node has program property
          if (
            astForFunctionMap &&
            (!astForFunctionMap.program || astForFunctionMap.program.type !== 'Program')
          ) {
            astForFunctionMap = null;
          }

          if (astForFunctionMap) {
            // Metro-compatible: generateFunctionMap may throw or produce warnings
            // Metro handles errors silently (function maps are optional)
            // Warnings from @babel/traverse are informational and don't prevent function map generation
            try {
              functionMap = generateFunctionMap(astForFunctionMap, {
                filename: modulePath,
              });
            } catch {
              // Function map generation failed - continue without it (Metro-compatible)
              // Metro silently ignores function map generation errors
              functionMap = null;
            }
          }
        } catch {
          // Function map generation is optional, continue without it
          // Errors are silently ignored as function maps are not critical for bundling
        }
      }

      // Check if module should be added to ignore list
      const isIgnored = config.serializer?.shouldAddToIgnoreList
        ? config.serializer.shouldAddToIgnoreList({
            path: modulePath,
            code: moduleCode,
            dependencies: serializerModule?.dependencies || [],
            type: 'js/module' as const,
          })
        : false;

      // sourceMapPath is always assigned (relativeModulePath)
      // Ensure it's never empty or undefined
      const finalSourceMapPath = sourceMapPath || relativeModulePath;
      metroModules.push({
        map: rawMappings,
        functionMap,
        path: finalSourceMapPath,
        source: sourceCode,
        code: moduleCode,
        isIgnored,
        lineCount: moduleCode.split('\n').length,
      });
    }

    // Generate source map using Metro's fromRawMappings API
    // offsetLines should be 0 since __prelude__ is included as the first module
    // The prelude's lineCount will be added to carryOver automatically
    const generator = fromRawMappings(metroModules, 0);

    // Convert Generator to source map JSON
    // Metro uses undefined for the file parameter (see sourceMapObject.js)
    const sourceMap = generator.toMap(undefined, {
      excludeSource,
    });

    return JSON.stringify(sourceMap);
  } catch (error) {
    // No fallback - let the error propagate for debugging
    console.error('Failed to generate source map:', error);
    throw error;
  }
}

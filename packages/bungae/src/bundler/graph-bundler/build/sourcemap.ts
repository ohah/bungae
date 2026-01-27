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

    // Metro-compatible: Use the same newline regex as metro-source-map's countLines
    // countLines = (string.match(newline) || []).length + 1
    // newline = /\r\n?|\n|\u2028|\u2029/g
    // This handles \r\n, \r, \n, and Unicode line separators
    const NEWLINE_REGEX = /\r\n?|\n|\u2028|\u2029/g;
    const countLines = (str: string): number => (str.match(NEWLINE_REGEX) || []).length + 1;

    // Calculate preLines using the same algorithm as fromRawMappings
    const preLines = countLines(bundle.pre);

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
    // IMPORTANT: Use empty array [] for map, not null - Metro uses [] for prelude
    //
    // CRITICAL: fromRawMappings uses countLines(code), NOT the lineCount field.
    // countLines = (newlines count) + 1, so trailing newline adds 1 extra line.
    // We must strip trailing newline from code to match Metro's convention.
    const preludeCode = bundle.pre.endsWith('\n') ? bundle.pre.slice(0, -1) : bundle.pre;

    // Metro-compatible: prelude path depends on sourcePaths mode
    // url-server mode: '/__prelude__' (with leading slash, via _getModuleSourceUrl fallback)
    // absolute mode: '__prelude__' (raw path)
    const preludePath = sourcePaths === 'url-server' ? '/__prelude__' : '__prelude__';
    metroModules.push({
      map: [], // Empty array, not null - Metro-compatible (prelude is not debuggable)
      functionMap: null,
      path: preludePath,
      source: bundle.pre,
      code: preludeCode, // Strip trailing newline for correct countLines calculation
      isIgnored: true, // Metro-compatible: prelude is always in ignoreList
      lineCount: preLines,
    });

    // Metro-compatible source map folder structure
    // Use the same sourceRequestRoutingMap and getSourceUrl from above
    // This ensures source map sources path matches verboseName
    const sourceRequestRoutingMap = buildSourceRequestRoutingMap(config);
    const getSourceUrl = createGetSourceUrl(config, sourceRequestRoutingMap);

    // CRITICAL: Sort modules in the same order as the actual bundle assembly
    // In build/index.ts, modules are sorted by moduleId before being concatenated
    // We must use the same order for accurate source map carryOver calculation
    const sortedBundleModules = bundle.modules
      .slice()
      .sort((a, b) => {
        const aId = typeof a[0] === 'number' ? a[0] : 0;
        const bId = typeof b[0] === 'number' ? b[0] : 0;
        return aId - bId;
      });

    // Process each module in the bundle (in sorted order to match bundle assembly)
    for (const [moduleId, moduleCode] of sortedBundleModules) {
      const modulePath = moduleIdToPath.get(moduleId);
      if (!modulePath) continue;

      // Find the module in serializer modules to get its source map
      const serializerModule = graphModuleByPath.get(modulePath);

      // Metro-compatible: verboseName is ALWAYS a relative path (e.g., "App.tsx")
      // For sourcePaths=url-server, Metro uses getSourceUrl for source map sources (e.g., "[metro-project]/App.tsx")
      // For sourcePaths=absolute, Metro uses absolute path (module.path)
      // React Native matches verboseName (relative) to source map sources by normalizing paths
      // Metro's behavior: verboseName="App.tsx", source map sources="[metro-project]/App.tsx" (url-server) or absolute path (absolute)
      const relativeModulePath = relative(config.root, modulePath).replace(/\\/g, '/');
      // Use getSourceUrl format for source map sources when sourcePaths=url-server (Metro-compatible)
      // Use absolute path when sourcePaths=absolute (Metro-compatible)
      const sourceMapPath =
        sourcePaths === 'url-server'
          ? getSourceUrl(modulePath) // Use [metro-project]/App.tsx format (Metro-compatible)
          : modulePath; // Use absolute path for absolute mode (Metro-compatible)

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

      // Track lineCount from source map data (Metro-compatible)
      // lineCount should be from the code at source map generation time, not from moduleCode
      let storedLineCount: number | undefined;

      if (serializerModule?.map) {
        try {
          const sourceMapData = JSON.parse(serializerModule.map);

          // Metro-compatible: Use rawMappings directly if available (like Metro's transformJS)
          // Metro's transformJS (line 474) uses rawMappings.map(toSegmentTuple) directly
          // This is the most accurate way to preserve source map mappings
          // Note: rawMappings are pre-converted to Metro tuple format in graphToSerializerModules()
          if (sourceMapData.rawMappings && Array.isArray(sourceMapData.rawMappings)) {
            // rawMappings are already in Metro tuple format: [line, column, sourceLine?, sourceColumn?, name?]
            // Just use them directly (Metro-compatible)
            rawMappings = sourceMapData.rawMappings;
            // Use stored lineCount from countLinesAndTerminateMap (Metro-compatible)
            if (sourceMapData.lineCount !== undefined) {
              storedLineCount = sourceMapData.lineCount;
            }
          } else if (sourceMapData.babelMap || (sourceMapData.sources && sourceMapData.mappings)) {
            // Fallback: Convert Babel source map to raw mappings using toBabelSegments and toSegmentTuple
            const babelSourceMap = sourceMapData.babelMap || sourceMapData;
            
            // Metro-compatible: Update source map sources path to match getSourceUrl format
            // Babel generates source map with absolute path or original path in sources array
            // We need to convert it to getSourceUrl format ([metro-project]/App.tsx) for proper matching
            // This ensures source map sources path matches verboseName for console log source location
            if (babelSourceMap.sources && babelSourceMap.sources.length > 0) {
              // Update sources array to use getSourceUrl format (Metro-compatible)
              // The first source should be the module path, convert it to getSourceUrl format
              const originalSource = babelSourceMap.sources[0];
              if (originalSource && originalSource !== sourceMapPath) {
                // Update source path to match getSourceUrl format
                babelSourceMap.sources = [sourceMapPath];
              }
            }
            
            const babelSegments = toBabelSegments(babelSourceMap);
            rawMappings = babelSegments.map(toSegmentTuple);
          } else {
            // If no valid source map data, create basic line-by-line mappings
            const moduleLines = moduleCode.split('\n').length;
            rawMappings = [];
            for (let i = 0; i < moduleLines; i++) {
              rawMappings.push([i + 1, 0, i + 1, 0]);
            }
          }
        } catch (error) {
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
          const astForFunctionMap = graphModuleForAst.transformedAst;

          {
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

      // Check if module should be added to ignore list (Metro-compatible)
      // Metro's default: isThirdPartyModule checks /node_modules/ in path
      // Metro also adds: __prelude__, context modules (?ctx=), and third-party modules
      const isIgnored = config.serializer?.shouldAddToIgnoreList
        ? config.serializer.shouldAddToIgnoreList({
            path: modulePath,
            code: moduleCode,
            dependencies: serializerModule?.dependencies || [],
            type: 'js/module' as const,
          })
        : /(?:^|[/\\])node_modules[/\\]/.test(modulePath);

      // sourceMapPath is always assigned (relativeModulePath)
      // Ensure it's never empty or undefined
      const finalSourceMapPath = sourceMapPath || relativeModulePath;

      // Metro-compatible: Use stored lineCount if available (from countLinesAndTerminateMap)
      // This ensures lineCount matches the code used for rawMappings generation
      // Fallback to calculating from moduleCode for modules without stored lineCount
      const moduleLineCount = storedLineCount ?? moduleCode.split('\n').length;

      // CRITICAL: Strip trailing newline for correct countLines calculation in fromRawMappings
      const codeForSourceMap = moduleCode.endsWith('\n') ? moduleCode.slice(0, -1) : moduleCode;
      metroModules.push({
        map: rawMappings,
        functionMap,
        path: finalSourceMapPath,
        source: sourceCode,
        code: codeForSourceMap, // Strip trailing newline for correct countLines calculation
        isIgnored,
        lineCount: moduleLineCount,
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
    }) as {
      version: number;
      sources: string[];
      sourcesContent?: (string | null)[];
      mappings: string;
      names: string[];
      x_google_ignoreList?: number[];
      [key: string]: unknown;
    };

    // Generate x_google_ignoreList based on isIgnored flags (Metro-compatible)
    // x_google_ignoreList is an array of source indices that should be ignored in DevTools
    const ignoreList: number[] = [];
    for (let i = 0; i < metroModules.length; i++) {
      const module = metroModules[i];
      if (module && module.isIgnored) {
        ignoreList.push(i);
      }
    }

    // Only add x_google_ignoreList if there are ignored modules (Metro-compatible)
    // Metro doesn't add x_google_ignoreList when empty
    if (ignoreList.length > 0) {
      sourceMap.x_google_ignoreList = ignoreList;
    }

    return JSON.stringify(sourceMap);
  } catch (error) {
    // No fallback - let the error propagate for debugging
    console.error('Failed to generate source map:', error);
    throw error;
  }
}

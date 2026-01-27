/**
 * Source map generation for Graph Bundler
 */

import { readFileSync } from 'fs';
import { relative } from 'path';
// @ts-expect-error vlq types don't resolve properly with package.json exports
import { decode as vlqDecode } from 'vlq';
import type { ResolvedConfig } from '../../../config/types';
import type { Module } from '../../../serializer/types';
import type { GraphModule } from '../types';
import { createGetSourceUrl, buildSourceRequestRoutingMap } from './utils';

/**
 * Metro-compatible raw mapping tuple
 * [generatedLine, generatedColumn] - no original mapping
 * [generatedLine, generatedColumn, originalLine, originalColumn] - with original mapping
 * [generatedLine, generatedColumn, originalLine, originalColumn, name] - with name
 */
type RawMappingTuple =
  | [number, number]
  | [number, number, number, number]
  | [number, number, number, number, string];

/**
 * Convert Babel source map to raw mapping tuples (Metro-compatible)
 * Uses VLQ decoding to parse the mappings string directly
 */
function babelSourceMapToRawMappings(sourceMap: any): RawMappingTuple[] {
  if (!sourceMap || !sourceMap.mappings) {
    return [];
  }

  const rawMappings: RawMappingTuple[] = [];
  const names = sourceMap.names || [];

  try {
    // Parse VLQ-encoded mappings string
    // Mappings format: lines separated by ';', segments separated by ','
    // Each segment is VLQ-encoded: [genCol, sourceIdx, origLine, origCol, nameIdx?]
    const lines = sourceMap.mappings.split(';');

    // Track cumulative values (VLQ uses relative values)
    let sourceIndex = 0;
    let originalLine = 0;
    let originalColumn = 0;
    let nameIndex = 0;

    for (let generatedLine = 0; generatedLine < lines.length; generatedLine++) {
      const line = lines[generatedLine];
      if (!line) continue;

      const segments = line.split(',');
      let generatedColumn = 0;

      for (const segment of segments) {
        if (!segment) continue;

        const decoded = vlqDecode(segment);
        if (decoded.length === 0) continue;

        // First value is always generated column (relative within line)
        generatedColumn += decoded[0];

        if (decoded.length === 1) {
          // No source mapping
          rawMappings.push([generatedLine + 1, generatedColumn]);
        } else if (decoded.length >= 4) {
          // Has source mapping
          sourceIndex += decoded[1];
          originalLine += decoded[2];
          originalColumn += decoded[3];

          if (decoded.length >= 5 && decoded[4] !== undefined) {
            // Has name
            nameIndex += decoded[4];
            const name = names[nameIndex];
            if (name) {
              rawMappings.push([
                generatedLine + 1,
                generatedColumn,
                originalLine + 1,
                originalColumn,
                name,
              ]);
            } else {
              rawMappings.push([generatedLine + 1, generatedColumn, originalLine + 1, originalColumn]);
            }
          } else {
            // No name
            rawMappings.push([generatedLine + 1, generatedColumn, originalLine + 1, originalColumn]);
          }
        }
      }
    }
  } catch (error) {
    console.warn('Failed to parse Babel source map:', error);
    return [];
  }

  return rawMappings;
}

export interface GenerateSourceMapOptions {
  config: ResolvedConfig;
  bundle: {
    pre: string;
    modules: Array<[number | string, string]>;
    /** Processed prepend modules with transformed code and source map */
    processedPreModules?: ReadonlyArray<[Module, string, any | null]>;
  };
  /** Prepended modules (prelude, metro-runtime, polyfills) - original modules */
  prependModules?: ReadonlyArray<Module>;
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
    prependModules,
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
    const { fromRawMappings, generateFunctionMap } = metroSourceMap;

    // Metro-compatible: Use the same newline regex as metro-source-map's countLines
    // countLines = (string.match(newline) || []).length + 1
    // newline = /\r\n?|\n|\u2028|\u2029/g
    // This handles \r\n, \r, \n, and Unicode line separators
    const NEWLINE_REGEX = /\r\n?|\n|\u2028|\u2029/g;
    const countLines = (str: string): number => (str.match(NEWLINE_REGEX) || []).length + 1;

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

    // Metro-compatible: Include prependModules in source map
    // Metro includes __prelude__, require.js, console.js, error-guard.js in the source map
    // so that x_google_ignoreList can work properly to skip these files in call stacks.
    //
    // IMPORTANT: Metro uses actual Babel-generated source maps for polyfills.
    // The first few lines of Metro's mappings start with ";;" (empty lines for prelude),
    // then real mappings like "ECAA,YAAY" for require.js.
    //
    // Now we also use Babel-generated source maps for script modules (require.js, console.js, etc.)
    // This enables x_google_ignoreList to work properly in Chrome DevTools.

    // Add prependModules to source map (Metro-compatible)
    // Use bundle.processedPreModules if available, otherwise use prependModules directly
    if (prependModules && prependModules.length > 0) {
      // If we have processedPreModules with source maps, use them
      // Otherwise, generate identity mappings from prependModules
      const preModulesWithMaps =
        bundle.processedPreModules ||
        prependModules.map((m) => [m, m.code, null] as [Module, string, any | null]);

      for (const [originalModule, transformedCode, scriptSourceMap] of preModulesWithMaps) {
        const moduleLines = transformedCode.split('\n').length;

        // Use module path for source name, or __prelude__ for virtual modules
        const sourcePath =
          originalModule.type === 'js/script/virtual' ? '__prelude__' : originalModule.path;

        // Convert Babel source map to raw mappings if available
        let rawMappings: Array<
          | [number, number]
          | [number, number, number, number]
          | [number, number, number, number, string]
        > = [];

        // Metro-compatible: __prelude__ uses empty mappings (just semicolons in the output)
        // This is critical for correct source map line offsets.
        // For other script modules, use Babel-generated source maps or identity mappings.
        if (originalModule.type === 'js/script/virtual') {
          // Keep rawMappings empty for __prelude__ - Metro does the same
          // fromRawMappings will use lineCount to add correct number of semicolons
        } else if (scriptSourceMap && scriptSourceMap.mappings) {
          // Use Babel-generated source map mappings (Metro-compatible)
          rawMappings = babelSourceMapToRawMappings(scriptSourceMap);
        }

        // Generate identity mapping for non-prelude modules without Babel source maps
        // Identity mapping: each line maps to the same line in source (retainLines: true)
        // This is needed for x_google_ignoreList to work properly
        if (originalModule.type !== 'js/script/virtual' && rawMappings.length === 0) {
          for (let i = 0; i < moduleLines; i++) {
            // [generatedLine, generatedColumn, originalLine, originalColumn]
            // Lines are 1-indexed in source maps
            rawMappings.push([i + 1, 0, i + 1, 0]);
          }
        }

        // Metro-compatible: IIFE wrapper line should have empty mapping
        // Metro starts real mappings from line 3 (after __prelude__ and IIFE wrapper)
        // The IIFE wrapper "(function (global) {" line should not have any mapping
        //
        // When we wrap code with IIFE, the line numbers shift by 1:
        // - Line 1: (function (global) { <- IIFE wrapper (no mapping)
        // - Line 2: "use strict";        <- original Line 1
        // - Line 3: ...                  <- original Line 2
        //
        // So we need to shift all generatedLine values by 1
        const isIIFEWrapped = transformedCode.trimStart().startsWith('(function');
        if (isIIFEWrapped && rawMappings.length > 0) {
          // Shift all generatedLine values by 1 to account for IIFE wrapper
          // This leaves line 1 (IIFE wrapper) with no mapping
          rawMappings = rawMappings.map((m) => {
            const newMapping = [...m] as typeof m;
            newMapping[0] = m[0] + 1; // Shift generatedLine by 1
            return newMapping;
          });
        }

        metroModules.push({
          map: rawMappings,
          functionMap: null,
          path: sourcePath,
          source: originalModule.code, // Original source code for sourcesContent
          code: transformedCode,
          isIgnored: true, // Mark as ignored (third-party/polyfill)
          lineCount: moduleLines,
        });
      }
    }

    // offsetLines = 0 since prependModules are now included in metroModules
    // fromRawMappings will calculate carryOver based on each module's lineCount
    const preLines = 0;

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
            // Fallback: Convert Babel source map to raw mappings
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

            rawMappings = babelSourceMapToRawMappings(babelSourceMap);
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
    // offsetLines = preLines to skip prependModules (prelude, metro-runtime, polyfills)
    // This ensures graph modules start at the correct line offset in the source map
    const sourceMapGenerator = fromRawMappings(metroModules, preLines);

    // Convert Generator to source map JSON
    // Metro-compatible: Do NOT set file field - Metro source maps don't have it
    // Setting file field may cause issues with DevTools source mapping
    const sourceMap = sourceMapGenerator.toMap(undefined, {
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

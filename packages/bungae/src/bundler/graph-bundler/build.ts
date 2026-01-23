/**
 * Build function for Graph Bundler
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve, relative, basename, extname } from 'path';
import { fileURLToPath } from 'url';

import type { ResolvedConfig } from '../../config/types';
import {
  baseJSBundle,
  getPrependedModules,
  createModuleIdFactory,
  getRunModuleStatement,
} from '../../serializer';
import { buildGraph, reorderGraph, graphToSerializerModules } from './graph';
import type { AssetInfo, BuildResult } from './types';
import { getImageSize } from './utils';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Build bundle using Graph + Metro module system
 */
export async function buildWithGraph(
  config: ResolvedConfig,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
): Promise<BuildResult> {
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

  // Reorder graph modules in DFS order (Metro-compatible)
  // This ensures module ID assignment matches Metro's behavior
  const orderedGraphModules = reorderGraph(graph, entryPath);
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

  // Serialize bundle
  const bundle = await baseJSBundle(entryPath, prependModules, graphModules, {
    createModuleId,
    getRunModuleStatement,
    dev,
    projectRoot: root,
    serverRoot: root,
    globalPrefix: '',
    runModule: true,
    runBeforeMainModule,
    inlineSourceMap: config.serializer?.inlineSourceMap ?? false,
  });

  // Combine bundle parts
  const code = [
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

  // Build a lookup map from module path to graph module to avoid repeated linear scans
  // This optimizes O(n²) to O(n) when processing bundle.modules
  const graphModuleByPath = new Map<string, (typeof graphModules)[number]>();
  for (const m of graphModules) {
    graphModuleByPath.set(m.path, m);
  }

  // Generate source map (dev mode only) - Metro-compatible using metro-source-map
  let map: string | undefined;
  if (dev) {
    try {
      // Use metro-source-map API (Metro-compatible)
      const metroSourceMap = await import('metro-source-map');
      const { toBabelSegments, toSegmentTuple, fromRawMappings, generateFunctionMap } =
        metroSourceMap;

      // Calculate prelude line offset
      const preLines = bundle.pre.split('\n').length;

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

      // Process each module in the bundle
      for (const [moduleId, moduleCode] of bundle.modules) {
        const modulePath = moduleIdToPath.get(moduleId);
        if (!modulePath) continue;

        // Find the module in graphModules to get its source map and AST
        const graphModule = graphModuleByPath.get(modulePath);
        const relativeModulePath = relative(root, modulePath);

        // Read original source code
        let sourceCode: string;
        try {
          sourceCode = readFileSync(modulePath, 'utf-8');
        } catch {
          sourceCode = graphModule?.code || '';
        }

        // Convert Babel source map to raw mappings (Metro format)
        let rawMappings: Array<
          | [number, number]
          | [number, number, number, number]
          | [number, number, number, number, string]
        > | null = null;
        let functionMap: any = null;

        if (graphModule?.map) {
          try {
            const babelSourceMap = JSON.parse(graphModule.map);
            // Convert Babel source map to raw mappings using toBabelSegments and toSegmentTuple
            // Babel source map's sources array may contain absolute or relative paths
            // Metro's fromRawMappings uses module.path for the sources array, so we need to ensure
            // the path matches what Babel expects. However, toBabelSegments/toSegmentTuple
            // only extract mappings, not source paths - Metro uses module.path for that.
            const babelSegments = toBabelSegments(babelSourceMap);
            rawMappings = babelSegments.map(toSegmentTuple);

            // Debug: Log source map conversion details
            if (config.dev) {
              const babelSources = babelSourceMap.sources || [];
              const babelMappingsCount = babelSourceMap.mappings
                ? babelSourceMap.mappings.split(';').length
                : 0;
              if (rawMappings.length === 0) {
                console.warn(
                  `⚠️ Empty source map mappings for ${relativeModulePath}. Babel had ${babelSources.length} sources, ${babelMappingsCount} mapping lines.`,
                );
              } else if (rawMappings.length < babelMappingsCount / 2) {
                // If we have significantly fewer mappings than Babel had, something might be wrong
                console.warn(
                  `⚠️ Fewer mappings than expected for ${relativeModulePath}: ${rawMappings.length} vs ${babelMappingsCount} Babel mapping lines.`,
                );
              }
            }
          } catch (error) {
            // If conversion fails, create basic line-by-line mappings
            // Metro includes modules even without source maps
            const moduleLines = moduleCode.split('\n').length;
            rawMappings = [];
            for (let i = 0; i < moduleLines; i++) {
              // [generatedLine, generatedColumn, sourceLine, sourceColumn]
              rawMappings.push([i + 1, 0, i + 1, 0]);
            }
            if (config.dev) {
              console.warn(
                `Failed to convert source map for ${modulePath}, using basic mappings:`,
                error,
              );
            }
          }
        } else {
          // No source map - create basic line-by-line mappings (Metro-compatible)
          // Metro includes all modules in source map even without mappings
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
              dependencies: graphModule?.dependencies || [],
              type: 'js/module' as const,
            })
          : false;

        metroModules.push({
          map: rawMappings,
          functionMap,
          path: relativeModulePath,
          source: sourceCode,
          code: moduleCode,
          isIgnored,
          lineCount: moduleCode.split('\n').length,
        });
      }

      // Generate source map using Metro's fromRawMappings API
      const generator = fromRawMappings(metroModules, preLines);

      // Convert Generator to source map JSON
      const sourceMap = generator.toMap(basename(entryPath), {
        excludeSource: false,
      });

      // Debug: Log source map info in dev mode
      if (config.dev) {
        const sourceCount = sourceMap.sources?.length || 0;
        const mappingsLength = sourceMap.mappings?.length || 0;
        const hasSourcesContent =
          Array.isArray(sourceMap.sourcesContent) && sourceMap.sourcesContent.length > 0;
        const mappingsLineCount = sourceMap.mappings ? sourceMap.mappings.split(';').length : 0;
        console.log(
          `✅ Generated source map: ${sourceCount} sources, ${mappingsLength} chars mappings (${mappingsLineCount} lines), sourcesContent: ${hasSourcesContent}`,
        );
        if (sourceCount > 0 && sourceCount <= 10) {
          console.log(`  Sources: ${sourceMap.sources.slice(0, 10).join(', ')}`);
        } else if (sourceCount > 10) {
          console.log(
            `  Sources (first 10): ${sourceMap.sources.slice(0, 10).join(', ')}... (${sourceCount} total)`,
          );
        }
        // Check if mappings are empty (indicates problem)
        if (mappingsLength === 0 || mappingsLineCount === 0) {
          console.warn(
            `⚠️ WARNING: Source map has empty mappings! This will prevent symbolication.`,
          );
        }
      }

      map = JSON.stringify(sourceMap);
    } catch (error) {
      // Fallback to basic source map if metro-source-map fails
      console.warn('Failed to generate source map with metro-source-map, using fallback:', error);
      const fallbackMap = {
        version: 3,
        file: basename(entryPath),
        sources: Array.from(graph.keys()).map((p) => relative(root, p)),
        names: [],
        mappings: '',
        sourcesContent: Array.from(graph.keys()).map((p) => {
          try {
            return readFileSync(p, 'utf-8');
          } catch {
            // Keep placeholder (null) to preserve 1:1 alignment with `sources`
            // Source map spec requires sourcesContent to have same length/order as sources
            return null;
          }
        }),
      };
      map = JSON.stringify(fallbackMap);
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
    // For non-inline source maps, add relative path sourceMappingURL
    // server.ts will replace this with full URL when serving via HTTP
    // For file-based builds (build command), relative path is sufficient
    const entryBaseName = basename(entryPath).replace(/\.(js|ts|jsx|tsx)$/, '') || 'index';
    const mapFileName = `${entryBaseName}.bundle.map`;
    const sourceMappingURLComment = `\n//# sourceMappingURL=${mapFileName}`;
    finalCode = code + sourceMappingURLComment;
  }

  // Extract asset files from bundle modules (only assets actually included in bundle)
  // Metro only copies assets that are actually required/imported in the bundle
  // CRITICAL: We need to analyze the actual bundle code to see which modules are actually required
  // Metro does this by checking which modules are actually __r() called in the bundle code

  // Analyze bundle code to find which modules are actually required
  // Metro includes modules in bundle.modules, but we need to check if they're actually used
  // Look for __r(moduleId) calls in the bundle code to see which modules are actually required
  const requiredModuleIds = new Set<number | string>();

  // Check pre code for requires
  if (bundle.pre) {
    const preRequires = bundle.pre.match(/__r\((\d+)\)/g);
    if (preRequires) {
      for (const req of preRequires) {
        const match = req.match(/__r\((\d+)\)/);
        if (match) {
          requiredModuleIds.add(Number(match[1]));
        }
      }
    }
  }

  // Check post code for requires
  if (bundle.post) {
    const postRequires = bundle.post.match(/__r\((\d+)\)/g);
    if (postRequires) {
      for (const req of postRequires) {
        const match = req.match(/__r\((\d+)\)/);
        if (match) {
          requiredModuleIds.add(Number(match[1]));
        }
      }
    }
  }

  // Analyze the entire bundle code to find which modules are actually required
  // Metro includes all modules that are reachable from entry point, but we need to check
  // which ones are actually __r() called in the bundle code
  const allBundleCode =
    bundle.pre + '\n' + bundle.modules.map(([, code]) => code).join('\n') + '\n' + bundle.post;

  // Find all __r() calls in the bundle code
  // Use a more robust regex that handles both number and string IDs
  const allRequires = allBundleCode.match(/__r\(([^)]+)\)/g);
  if (allRequires) {
    for (const req of allRequires) {
      const match = req.match(/__r\(([^)]+)\)/);
      if (match && match[1]) {
        const moduleIdStr = match[1].trim();
        // Try to parse as number first, then as string
        const moduleId = /^\d+$/.test(moduleIdStr) ? Number(moduleIdStr) : moduleIdStr;
        requiredModuleIds.add(moduleId);
      }
    }
  }

  // CRITICAL: Metro only includes assets that are actually __r() called in the bundle code
  // Even if a module is defined with __d(), it's not included unless it's actually required
  // So we ONLY include modules that are in requiredModuleIds (from __r() calls)

  // Debug: Check which asset modules are in requiredModuleIds
  const _requiredAssetIds = Array.from(requiredModuleIds).filter((id) => {
    const path = moduleIdToPath.get(id);
    return (
      path &&
      config.resolver.assetExts.some((ext) => {
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        return path.endsWith(normalizedExt);
      })
    );
  });

  // Also check which asset modules are in bundle.modules but NOT in requiredModuleIds
  const allAssetIds = bundle.modules
    .map(([id]) => id)
    .filter((id) => {
      const path = moduleIdToPath.get(id);
      return (
        path &&
        config.resolver.assetExts.some((ext) => {
          const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
          return path.endsWith(normalizedExt);
        })
      );
    });
  const _unusedAssetIds = allAssetIds.filter((id) => !requiredModuleIds.has(id));

  // CRITICAL FIX: Only include modules that are actually required in the bundle code
  // Metro only copies assets that are actually __r() called, not just defined with __d()
  // However, assets are not directly __r() called - they are required by other modules
  // We need to follow the dependency graph from __r() called modules to find assets

  // Create reverse mapping: path -> moduleId (for dependency lookup)
  const pathToModuleId = new Map<string, number | string>();
  for (const [moduleId, path] of moduleIdToPath.entries()) {
    pathToModuleId.set(path, moduleId);
  }

  // Log debug info
  if (requiredModuleIds.size === 0) {
    console.error(`ERROR: No modules found in __r() calls! Bundle code analysis may have failed.`);
    console.error(`ERROR: This means NO assets should be copied (Metro behavior)`);
  }

  // Only include assets that are actually used
  // Start with __r() called modules and recursively add their dependencies
  // This follows the dependency graph from __r() called modules to find all used modules including assets
  // CRITICAL: We only include modules that are actually require()'d, not just referenced in dependencyMap
  const bundledModulePaths = new Set<string>();
  const modulesToInclude = new Set(requiredModuleIds);
  const processedModuleIds = new Set<number | string>();

  // Recursively add dependencies of __r() called modules
  while (modulesToInclude.size > 0) {
    const currentModuleId = Array.from(modulesToInclude)[0];
    if (currentModuleId === undefined) break;
    modulesToInclude.delete(currentModuleId);

    if (processedModuleIds.has(currentModuleId)) {
      continue;
    }
    processedModuleIds.add(currentModuleId);

    const modulePath = moduleIdToPath.get(currentModuleId);
    if (modulePath) {
      bundledModulePaths.add(modulePath);

      // Find this module's code and get its dependencies from dependencyMap
      const moduleCode = bundle.modules.find(([id]) => id === currentModuleId)?.[1];
      if (moduleCode) {
        // Try multiple regex patterns to match __d() format
        // Format: __d(function..., moduleId, [deps...])
        // The function can be very long, so we need a more flexible regex
        let depMapMatch = moduleCode.match(/__d\([^,]+,\s*(\d+),\s*\[([^\]]+)\]/);
        if (!depMapMatch) {
          // Try without spaces around moduleId
          depMapMatch = moduleCode.match(/__d\([^,]+,(\d+),\[([^\]]+)\]/);
        }
        if (!depMapMatch) {
          // Try matching the end of __d() call: },moduleId,[deps])
          depMapMatch = moduleCode.match(/},\s*(\d+),\s*\[([^\]]+)\]/);
        }
        if (depMapMatch) {
          const moduleIdFromMatch = Number(depMapMatch[1]);
          // Verify this matches the current module ID
          if (
            moduleIdFromMatch !== currentModuleId &&
            String(moduleIdFromMatch) !== String(currentModuleId)
          ) {
            // Module ID mismatch, skip
            depMapMatch = null;
          }
        }
        if (depMapMatch) {
          const depsStr = depMapMatch[2];
          if (depsStr) {
            const deps = depsStr
              .split(',')
              .map((d) => d.trim())
              .filter((d) => d && d !== '');
            // Find which dependencyMap indices are actually used in require() calls
            // Metro only includes dependencies that are actually require()'d
            // Pattern: require(dependencyMap[index])
            // CRITICAL: In release builds, exclude requires inside __DEV__ conditional blocks
            const usedDepIndices = new Set<number>();
            const requireMatches = moduleCode.match(/require\(dependencyMap\[(\d+)\]\)/g);
            if (requireMatches) {
              for (const match of requireMatches) {
                const indexMatch = match.match(/require\(dependencyMap\[(\d+)\]\)/);
                if (indexMatch) {
                  const depIndex = Number(indexMatch[1]);

                  // In release builds, exclude requires inside __DEV__ conditional blocks
                  // Metro replaces __DEV__ with false in release builds, so conditional blocks are removed
                  // But if __DEV__ is still in the code, we need to exclude requires inside those blocks
                  if (!config.dev) {
                    // Find the position of this require in the code
                    let requirePos = -1;
                    let searchStart = 0;
                    while (true) {
                      const pos = moduleCode.indexOf(match, searchStart);
                      if (pos === -1) break;
                      // Check if this is the same require we're looking for (by checking the index)
                      const testMatch = moduleCode
                        .substring(pos)
                        .match(/require\(dependencyMap\[(\d+)\]\)/);
                      if (testMatch && Number(testMatch[1]) === depIndex) {
                        requirePos = pos;
                        break;
                      }
                      searchStart = pos + 1;
                    }

                    if (requirePos >= 0) {
                      // Look backwards to find if this require is inside a __DEV__ conditional
                      const beforeRequire = moduleCode.substring(
                        Math.max(0, requirePos - 2000),
                        requirePos,
                      );

                      // Find the last occurrence of __DEV__ conditional patterns before this require
                      // Patterns: if (__DEV__), if (process.env.NODE_ENV === 'development'), __DEV__ &&, __DEV__ ?
                      // Also check for transformed patterns: if (false), if ('production' === 'development'), false &&
                      const devConditionPatterns = [
                        { pattern: /if\s*\(\s*__DEV__\s*\)/g, needsBrace: true },
                        {
                          pattern:
                            /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*['"]development['"]\s*\)/g,
                          needsBrace: true,
                        },
                        { pattern: /__DEV__\s*&&/g, needsBrace: false },
                        { pattern: /__DEV__\s*\?/g, needsBrace: false },
                        // Transformed patterns (after Babel transformation in release builds)
                        { pattern: /if\s*\(\s*false\s*\)/g, needsBrace: true },
                        {
                          pattern: /if\s*\(\s*['"]production['"]\s*===\s*['"]development['"]\s*\)/g,
                          needsBrace: true,
                        },
                        {
                          pattern: /if\s*\(\s*['"]development['"]\s*!==\s*['"]production['"]\s*\)/g,
                          needsBrace: true,
                        },
                        { pattern: /false\s*&&/g, needsBrace: false },
                      ];

                      let isInDevBlock = false;
                      for (const { pattern, needsBrace } of devConditionPatterns) {
                        const matches = [...beforeRequire.matchAll(pattern)];
                        if (matches.length > 0) {
                          // Find the last match
                          const lastMatch = matches[matches.length - 1];
                          if (lastMatch && lastMatch.index !== undefined) {
                            const matchPos = lastMatch.index;
                            const codeAfterMatch = beforeRequire.substring(matchPos);

                            if (needsBrace) {
                              // Count braces to see if we're still inside the conditional block
                              let braceCount = 0;
                              let inString = false;
                              let stringChar = '';

                              for (let i = 0; i < codeAfterMatch.length; i++) {
                                const char = codeAfterMatch[i];
                                if (!inString && (char === '"' || char === "'" || char === '`')) {
                                  inString = true;
                                  stringChar = char;
                                } else if (
                                  inString &&
                                  char === stringChar &&
                                  (i === 0 || codeAfterMatch[i - 1] !== '\\')
                                ) {
                                  inString = false;
                                } else if (!inString) {
                                  if (char === '{') braceCount++;
                                  else if (char === '}') braceCount--;
                                }
                              }

                              // If we have unclosed braces, we're still inside the conditional block
                              if (braceCount > 0) {
                                isInDevBlock = true;
                                break;
                              }
                            } else {
                              // For && and ? operators, check if require is on the same "line" (before next ; or })
                              const matchLength = lastMatch[0]?.length || 0;
                              const codeAfterMatchToRequire = moduleCode.substring(
                                matchPos + matchLength,
                                requirePos,
                              );
                              // Check if require is part of the expression (no semicolon, closing brace, or newline before it)
                              // Patterns: __DEV__ &&, __DEV__ ?, false && (transformed __DEV__ &&)
                              const isDevPattern =
                                lastMatch[0].includes('__DEV__') || lastMatch[0].includes('false');
                              if (isDevPattern && !codeAfterMatchToRequire.match(/[;}\n]/)) {
                                isInDevBlock = true;
                                break;
                              }
                            }
                          }
                        }
                      }

                      if (isInDevBlock) {
                        console.log(
                          `Excluding require(dependencyMap[${depIndex}]) in module ${currentModuleId} - inside __DEV__ conditional (release build)`,
                        );
                        continue;
                      }
                    }
                  }

                  usedDepIndices.add(depIndex);
                }
              }
            }

            // Add dependencies that are actually used (referenced in dependencyMap)
            // CRITICAL: Only add dependencies that are actually used in the code
            // For assets, we need to be extra careful - Metro only includes assets that are actually require()'d
            for (const depIndex of usedDepIndices) {
              if (depIndex < deps.length) {
                const depModuleIdStr = deps[depIndex];
                if (depModuleIdStr) {
                  const depModuleId = /^\d+$/.test(depModuleIdStr)
                    ? Number(depModuleIdStr)
                    : depModuleIdStr;
                  const depPath = moduleIdToPath.get(depModuleId);

                  if (!depPath) continue;

                  // Check if this is an asset
                  const isAsset = config.resolver.assetExts.some((ext) => {
                    const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
                    return depPath.endsWith(normalizedExt);
                  });

                  // CRITICAL FIX: For assets, we need to verify that:
                  // 1. The dependencyMap[depIndex] is actually used in require() calls
                  // 2. The depModuleId at dependencyMap[depIndex] is actually an asset module ID
                  // 3. The require() call is for the asset (not just any dependencyMap[index])
                  // NOTE: usedDepIndices already contains only indices that are require()'d,
                  // so if depIndex is in usedDepIndices, it means require(dependencyMap[depIndex]) is called
                  if (isAsset) {
                    // Since depIndex is in usedDepIndices, it means require(dependencyMap[depIndex]) is called
                    // This is the asset that is actually required
                    if (!processedModuleIds.has(depModuleId)) {
                      modulesToInclude.add(depModuleId);
                    }
                  } else {
                    // For non-assets, add if not already processed
                    if (!processedModuleIds.has(depModuleId)) {
                      modulesToInclude.add(depModuleId);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Metro behavior: Extract assets from modules that are actually included in bundle
  // Metro's getAssets function receives graph.dependencies (all modules in bundle)
  // and filters them with processModuleFilter, then extracts assets
  // We use bundledModulePaths which contains only modules that are actually executed
  // (reachable from __r() called modules via require() calls)
  const assets: AssetInfo[] = [];
  for (const modulePath of bundledModulePaths) {
    // Check if this is an asset file
    const isAsset = config.resolver.assetExts.some((ext) => {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      return modulePath.endsWith(normalizedExt);
    });

    if (isAsset) {
      // Get original module from graph to access code for scales extraction
      const graphModule = graph.get(modulePath);
      const { width, height } = getImageSize(modulePath);
      const name = basename(modulePath, extname(modulePath));
      const type = extname(modulePath).slice(1);
      const relativePath = relative(root, dirname(modulePath));
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');
      const httpServerLocation =
        normalizedRelativePath && normalizedRelativePath !== '.'
          ? `/assets/${normalizedRelativePath}`
          : '/assets';

      // Extract scales from asset code (default to [1] if not found)
      // Metro uses scales array to determine which drawable folders to create
      let scales = [1]; // Default scale
      try {
        // Try to extract scales from the module code
        const moduleCode = graphModule?.code;
        if (moduleCode && typeof moduleCode === 'string' && moduleCode.includes('scales:')) {
          const scalesMatch = moduleCode.match(/scales:\s*\[([^\]]+)\]/);
          if (scalesMatch) {
            const scalesStr = scalesMatch[1];
            if (scalesStr) {
              const extractedScales = scalesStr
                .split(',')
                .map((s) => parseFloat(s.trim()))
                .filter((s) => !isNaN(s));
              if (extractedScales.length > 0) {
                scales = extractedScales;
              }
            }
          }
        }
      } catch {
        // If extraction fails, use default [1]
      }

      assets.push({
        filePath: modulePath,
        httpServerLocation,
        name,
        type,
        width,
        height,
        scales,
      });
    }
  }

  return { code: finalCode, map: finalMap, assets, graph, createModuleId };
}

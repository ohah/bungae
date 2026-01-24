/**
 * Asset extraction for Graph Bundler
 */

import { basename, dirname, extname, relative } from 'path';
import type { ResolvedConfig } from '../../../config/types';
import type { AssetInfo, GraphModule } from '../types';
import { getImageSize } from '../utils';

export interface ExtractAssetsOptions {
  config: ResolvedConfig;
  bundle: {
    pre: string;
    post: string;
    modules: Array<[number | string, string]>;
  };
  moduleIdToPath: Map<number | string, string>;
  graph: Map<string, GraphModule>;
}

/**
 * Extract asset files from bundle modules (only assets actually included in bundle)
 * Metro only copies assets that are actually required/imported in the bundle
 * CRITICAL: We need to analyze the actual bundle code to see which modules are actually required
 * Metro does this by checking which modules are actually __r() called in the bundle code
 */
export function extractAssets(options: ExtractAssetsOptions): AssetInfo[] {
  const { config, bundle, moduleIdToPath, graph } = options;
  const { root } = config;

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

  return assets;
}

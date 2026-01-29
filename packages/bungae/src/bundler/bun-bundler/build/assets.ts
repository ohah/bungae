/**
 * Asset extraction for Bun Bundler
 *
 * Metro-compatible: Assets are extracted from modules that are actually included in the bundle.
 * Dead code elimination happens at the transformation phase (babel-plugin-minify-dead-code-elimination),
 * so `if (__DEV__) { ... }` blocks are removed before reaching this stage in production builds.
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
 *
 * Metro-compatible approach:
 * 1. __DEV__ is replaced with true/false at transformation phase (babel-plugin-transform-define)
 * 2. Dead code elimination removes `if (false) { ... }` blocks (babel-plugin-minify-dead-code-elimination)
 * 3. Asset extraction simply processes remaining modules in the bundle
 *
 * This is much simpler and more reliable than analyzing __DEV__ conditionals at runtime.
 */
export function extractAssets(options: ExtractAssetsOptions): AssetInfo[] {
  const { config, bundle, moduleIdToPath, graph } = options;
  const { root } = config;

  // Find all modules that are actually required in the bundle
  // Look for __r(moduleId) calls in the bundle code
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

  // Find all __r() calls in module code
  const allBundleCode =
    bundle.pre + '\n' + bundle.modules.map(([, code]) => code).join('\n') + '\n' + bundle.post;

  const allRequires = allBundleCode.match(/__r\(([^)]+)\)/g);
  if (allRequires) {
    for (const req of allRequires) {
      const match = req.match(/__r\(([^)]+)\)/);
      if (match && match[1]) {
        const moduleIdStr = match[1].trim();
        const moduleId = /^\d+$/.test(moduleIdStr) ? Number(moduleIdStr) : moduleIdStr;
        requiredModuleIds.add(moduleId);
      }
    }
  }

  // Build set of all bundled module paths by following dependency graph
  const bundledModulePaths = new Set<string>();
  const modulesToProcess = new Set(requiredModuleIds);
  const processedModuleIds = new Set<number | string>();

  while (modulesToProcess.size > 0) {
    const currentModuleId = Array.from(modulesToProcess)[0];
    if (currentModuleId === undefined) break;
    modulesToProcess.delete(currentModuleId);

    if (processedModuleIds.has(currentModuleId)) {
      continue;
    }
    processedModuleIds.add(currentModuleId);

    const modulePath = moduleIdToPath.get(currentModuleId);
    if (modulePath) {
      bundledModulePaths.add(modulePath);

      // Find this module's dependencies from the bundle code
      const moduleCode = bundle.modules.find(([id]) => id === currentModuleId)?.[1];
      if (moduleCode) {
        // Extract dependencyMap from __d() call
        let depMapMatch = moduleCode.match(/__d\([^,]+,\s*(\d+),\s*\[([^\]]*)\]/);
        if (!depMapMatch) {
          depMapMatch = moduleCode.match(/__d\([^,]+,(\d+),\[([^\]]*)\]/);
        }
        if (!depMapMatch) {
          depMapMatch = moduleCode.match(/},\s*(\d+),\s*\[([^\]]*)\]/);
        }

        if (depMapMatch) {
          const moduleIdFromMatch = Number(depMapMatch[1]);
          // Verify module ID matches
          if (
            moduleIdFromMatch === currentModuleId ||
            String(moduleIdFromMatch) === String(currentModuleId)
          ) {
            const depsStr = depMapMatch[2];
            if (depsStr) {
              const deps = depsStr
                .split(',')
                .map((d) => d.trim())
                .filter((d) => d && d !== '');

              // Find which dependencyMap indices are actually used in require() calls
              // Metro-compatible: Match both _$$_REQUIRE(_dependencyMap[...]) and require(dependencyMap[...])
              const usedDepIndices = new Set<number>();
              const requireMatches = moduleCode.match(
                /(?:_\$\$_REQUIRE\(_dependencyMap|require\(dependencyMap)\[(\d+)\]\)/g,
              );

              if (requireMatches) {
                for (const match of requireMatches) {
                  const indexMatch = match.match(
                    /(?:_\$\$_REQUIRE\(_dependencyMap|require\(dependencyMap)\[(\d+)\]\)/,
                  );
                  if (indexMatch) {
                    usedDepIndices.add(Number(indexMatch[1]));
                  }
                }
              }

              // Add used dependencies to processing queue
              for (const depIndex of usedDepIndices) {
                if (depIndex < deps.length) {
                  const depModuleIdStr = deps[depIndex];
                  if (depModuleIdStr) {
                    const depModuleId = /^\d+$/.test(depModuleIdStr)
                      ? Number(depModuleIdStr)
                      : depModuleIdStr;
                    if (!processedModuleIds.has(depModuleId)) {
                      modulesToProcess.add(depModuleId);
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

  // Extract assets from bundled modules
  const assets: AssetInfo[] = [];
  for (const modulePath of bundledModulePaths) {
    // Check if this is an asset file
    const isAsset = config.resolver.assetExts.some((ext) => {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      return modulePath.endsWith(normalizedExt);
    });

    if (isAsset) {
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

      // Extract scales from asset code
      let scales = [1];
      try {
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
        // Use default [1]
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

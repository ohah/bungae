/**
 * Get append scripts - Entry execution and source map
 */

import type { Module } from '../types';
import type { SerializerOptions } from '../types';

/**
 * Get scripts to append after modules (entry execution, source map)
 */
export function getAppendScripts(
  entryPoint: string,
  modules: ReadonlyArray<Module>,
  options: SerializerOptions,
): ReadonlyArray<Module> {
  const output: Module[] = [];

  // Entry execution
  if (options.runModule) {
    const paths = [...(options.runBeforeMainModule || []), entryPoint];

    for (const modulePath of paths) {
      // Find module in graph (exact match or path resolution)
      const module = modules.find((m) => {
        // Exact path match
        if (m.path === modulePath) return true;
        // Try resolving both paths to see if they point to the same file
        try {
          const pathModule = require('path');
          const resolved1 = pathModule.resolve(m.path);
          const resolved2 = pathModule.resolve(modulePath);
          return resolved1 === resolved2;
        } catch {
          return false;
        }
      });

      if (module) {
        const moduleId = options.createModuleId(module.path);
        const code = options.getRunModuleStatement(moduleId, options.globalPrefix);

        output.push({
          path: `require-${modulePath}`,
          code,
          dependencies: [],
        });
      } else if (options.dev) {
        // In dev mode, warn if runBeforeMainModule module is not found
        console.warn(
          `Warning: Module "${modulePath}" specified in runBeforeMainModule was not found in the dependency graph.`,
        );
      }
    }
  }

  // Source map URL or inline source map
  // Metro-compatible: inlineSourceMap option
  if (options.inlineSourceMap || options.sourceMapUrl) {
    let sourceMappingURL: string;

    if (options.inlineSourceMap) {
      // Generate inline source map (base64 encoded)
      // TODO: Implement full source map generation with x_google_ignoreList
      // For now, use sourceMapUrl if available, otherwise skip
      if (options.sourceMapUrl) {
        sourceMappingURL = options.sourceMapUrl;
      } else {
        // Phase 2: Implement inline source map generation
        // const sourceMap = generateSourceMap(modules, options);
        // const base64 = Buffer.from(sourceMap).toString('base64');
        // sourceMappingURL = `data:application/json;charset=utf-8;base64,${base64}`;
        // For now, skip if no sourceMapUrl
        return output;
      }
    } else {
      sourceMappingURL = options.sourceMapUrl!;
    }

    const code = `//# sourceMappingURL=${sourceMappingURL}`;
    output.push({
      path: 'source-map',
      code,
      dependencies: [],
    });
  }

  // Source URL
  if (options.sourceUrl) {
    output.push({
      path: 'source-url',
      code: `//# sourceURL=${options.sourceUrl}`,
      dependencies: [],
    });
  }

  return output;
}

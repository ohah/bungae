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
          const fs = require('fs');

          // Normalize both paths
          let resolved1: string;
          let resolved2: string;

          // Use projectRoot from options if available, otherwise use process.cwd()
          const projectRoot = options.projectRoot || process.cwd();

          // Resolve m.path (could be relative or absolute)
          if (pathModule.isAbsolute(m.path)) {
            resolved1 = pathModule.normalize(m.path);
          } else {
            // If relative, resolve from projectRoot (not process.cwd())
            resolved1 = pathModule.resolve(projectRoot, m.path);
          }

          // Resolve modulePath (could be relative or absolute)
          if (pathModule.isAbsolute(modulePath)) {
            resolved2 = pathModule.normalize(modulePath);
          } else {
            // If relative, resolve from projectRoot (not process.cwd())
            resolved2 = pathModule.resolve(projectRoot, modulePath);
          }

          // Compare normalized paths
          if (resolved1 === resolved2) return true;

          // Also try comparing with realpath (follows symlinks)
          try {
            const real1 = fs.realpathSync(resolved1);
            const real2 = fs.realpathSync(resolved2);
            if (real1 === real2) return true;
          } catch {
            // realpathSync may fail if file doesn't exist, ignore
          }

          // Fallback: check if paths end with the same relative path segment
          // This handles cases like:
          // - m.path: "../../node_modules/.../InitializeCore.js"
          // - modulePath: "/absolute/path/.../InitializeCore.js"
          const normalized1 = pathModule.normalize(m.path).replace(/\\/g, '/');
          const normalized2 = pathModule.normalize(modulePath).replace(/\\/g, '/');

          // Extract last 3 path segments for comparison
          const segments1 = normalized1
            .split('/')
            .filter((s: string) => s)
            .slice(-3);
          const segments2 = normalized2
            .split('/')
            .filter((s: string) => s)
            .slice(-3);

          if (segments1.length === segments2.length && segments1.length > 0) {
            if (segments1.join('/') === segments2.join('/')) {
              return true;
            }
          }
        } catch {
          return false;
        }

        return false;
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
        if (modulePath.includes('InitializeCore')) {
          console.error(`CRITICAL: InitializeCore not found! Touch events will not work.`);
        }
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

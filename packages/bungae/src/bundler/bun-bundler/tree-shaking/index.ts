/**
 * Tree Shaking - Remove unused exports and modules
 *
 * This module analyzes the dependency graph to identify and remove:
 * 1. Unused exports from modules
 * 2. Unused modules that are not reachable from the entry point
 *
 * Tree shaking is only applied in production builds (when dev=false)
 *
 * ⚠️ IMPORTANT COMPATIBILITY WARNINGS:
 *
 * Metro includes ALL exports in bundles, allowing dynamic access at runtime.
 * Tree shaking removes unused exports, which can break code that:
 *
 * 1. **Dynamically accesses exports**:
 *    - `require('module')[dynamicKey]`
 *    - `module.exports[key]`
 *    - `Object.keys(require('module'))`
 *
 * 2. **Uses CommonJS with dynamic exports**:
 *    - CommonJS modules export the entire `module.exports` object
 *    - Tree shaking may remove exports that are accessed dynamically
 *
 * 3. **Has side effects**:
 *    - Code that runs at module load time (not just when exports are used)
 *    - Polyfills, global registrations, etc.
 *
 * RECOMMENDATIONS:
 * - Only enable tree shaking if you're certain your code doesn't use dynamic access
 * - Test thoroughly after enabling tree shaking
 * - Consider using `package.json` `sideEffects` field to mark modules with side effects
 * - CommonJS modules are safer (treated as namespace imports = all exports kept)
 */

import type { GraphModule } from '../types';
import { analyzeUsedExports } from './analyze-used-exports';
import { removeUnusedExports } from './remove-unused-exports';
import { hasSideEffects } from './side-effects';

// Re-export types
export type { ExportInfo, ImportInfo, UsedExports } from './types';

// Re-export extraction functions
export { extractExports } from './extract-exports';
export { extractImports } from './extract-imports';

// Re-export analysis function
export { analyzeUsedExports } from './analyze-used-exports';

/**
 * Apply tree shaking to the dependency graph
 * Removes unused exports and modules
 */
export async function applyTreeShaking(
  graph: Map<string, GraphModule>,
  entryPath: string,
): Promise<Map<string, GraphModule>> {
  // Analyze which exports are used
  const usedExports = await analyzeUsedExports(graph, entryPath);

  // Create a new graph with tree-shaken modules
  const shakenGraph = new Map<string, GraphModule>();

  for (const [path, module] of graph.entries()) {
    const usage = usedExports.get(path);

    // Skip modules that are not reachable from entry
    if (!usage || (!usage.allUsed && usage.used.size === 0)) {
      // Check if module has side effects before removing
      const moduleHasSideEffects = await hasSideEffects(path);
      if (moduleHasSideEffects) {
        // Keep modules with side effects even if no exports are used
        shakenGraph.set(path, module);
      }
      // Otherwise, skip (remove) the module
      continue;
    }

    // Remove unused exports from AST
    let shakenAst = module.transformedAst;
    if (module.transformedAst && !usage.allUsed) {
      // Check if module has side effects - if so, keep all exports
      const moduleHasSideEffects = await hasSideEffects(path);
      if (!moduleHasSideEffects) {
        shakenAst = await removeUnusedExports(module.transformedAst, usage);
      }
      // If has side effects, keep all exports (don't shake)
    }

    // Create new module with shaken AST
    const shakenModule: GraphModule = {
      ...module,
      transformedAst: shakenAst,
    };

    shakenGraph.set(path, shakenModule);
  }

  return shakenGraph;
}

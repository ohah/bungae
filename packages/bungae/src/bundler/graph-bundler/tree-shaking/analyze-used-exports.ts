/**
 * Analyze Used Exports
 *
 * Analyzes the dependency graph to find which exports are actually used
 */

import type { GraphModule } from '../types';
import { extractExports } from './extract-exports';
import { extractImports } from './extract-imports';
import type { UsedExports } from './types';

/**
 * Analyze the dependency graph to find which exports are used
 * Returns a map from module path to used exports
 */
export async function analyzeUsedExports(
  graph: Map<string, GraphModule>,
  entryPath: string,
): Promise<Map<string, UsedExports>> {
  const usedExports = new Map<string, UsedExports>();
  const visited = new Set<string>();

  // Initialize all modules as having no used exports
  for (const [path] of graph.entries()) {
    usedExports.set(path, { used: new Set(), allUsed: false });
  }

  /**
   * Mark exports as used from a module
   * Handles circular dependencies by merging usage info on revisit
   */
  async function markExportsUsed(
    modulePath: string,
    exportNames: string[],
    isNamespace: boolean = false,
  ): Promise<void> {
    const wasVisited = visited.has(modulePath);
    const usage = usedExports.get(modulePath)!;

    // Merge usage info (handles circular dependencies)
    if (isNamespace || exportNames.includes('*')) {
      usage.allUsed = true;
    } else {
      for (const name of exportNames) {
        usage.used.add(name);
      }
    }

    // If already visited, we still need to process re-exports to ensure
    // transitive dependencies are marked as used
    if (wasVisited) {
      // Continue processing to handle re-exports even on revisit
      // This ensures circular dependencies don't prevent re-export tracking
    } else {
      visited.add(modulePath);
    }

    const module = graph.get(modulePath);
    if (!module) return;

    // Usage info already merged above, continue with processing

    // Extract imports from this module and recursively mark them as used
    if (module.transformedAst) {
      const imports = await extractImports(module.transformedAst);

      for (const imp of imports) {
        // Find the resolved module path by matching with originalDependencies first
        // originalDependencies contains unresolved specifiers (e.g., './utils')
        // which match imp.sourceModule (also unresolved)
        let resolvedPath: string | undefined;

        // Match by originalDependencies (unresolved specifiers)
        const depIndex = module.originalDependencies.findIndex(
          (origDep) => origDep === imp.sourceModule,
        );

        if (depIndex >= 0 && depIndex < module.dependencies.length) {
          // Found matching original dependency, get corresponding resolved path
          resolvedPath = module.dependencies[depIndex];
        } else {
          // Fallback: try matching resolved paths directly
          // This handles cases where originalDependencies might not match exactly
          resolvedPath = module.dependencies.find((dep) => {
            let normalizedSource = imp.sourceModule.replace(/\\/g, '/');
            // Strip common leading prefixes from the source for comparison
            if (normalizedSource.startsWith('./')) {
              normalizedSource = normalizedSource.slice(2);
            } else if (normalizedSource.startsWith('../')) {
              normalizedSource = normalizedSource.slice(3);
            } else if (normalizedSource.startsWith('/')) {
              normalizedSource = normalizedSource.slice(1);
            }

            const normalizedDep = dep.replace(/\\/g, '/');
            // Compare without extensions to handle "./utils" vs "./utils.js"
            const normalizedDepWithoutExt = normalizedDep.replace(/\.[^/.]+$/, '');
            const normalizedSourceWithoutExt = normalizedSource.replace(/\.[^/.]+$/, '');

            return (
              normalizedDep === normalizedSource ||
              normalizedDepWithoutExt === normalizedSourceWithoutExt ||
              normalizedDepWithoutExt.endsWith('/' + normalizedSourceWithoutExt)
            );
          });

          // If still not found, try matching by filename (only for bare specifiers)
          if (!resolvedPath) {
            const hasPathSeparator =
              imp.sourceModule.includes('/') || imp.sourceModule.includes('\\');
            if (!hasPathSeparator) {
              const sourceFileName = imp.sourceModule.split('/').pop() || imp.sourceModule;
              const sourceFileNameWithoutExt = sourceFileName.replace(/\.[^/.]+$/, '');
              resolvedPath = module.dependencies.find((dep) => {
                const depFileName = (dep.split('/').pop() || dep).replace(/\.[^/.]+$/, '');
                return depFileName === sourceFileNameWithoutExt;
              });
            }
          }
        }

        if (resolvedPath && graph.has(resolvedPath)) {
          const importNames = imp.isNamespace ? ['*'] : [imp.name];
          await markExportsUsed(resolvedPath, importNames, imp.isNamespace);
        }
      }

      // Extract exports from this module
      // For re-exports, mark the source module's exports as used
      const exports = await extractExports(module.transformedAst);

      for (const exp of exports) {
        if (exp.isReExport && exp.sourceModule) {
          // Find the resolved module path for re-export
          // Use originalDependencies to match unresolved specifiers
          let resolvedPath: string | undefined;

          // Match by originalDependencies (unresolved specifiers)
          const depIndex = module.originalDependencies.findIndex(
            (origDep) => origDep === exp.sourceModule,
          );

          if (depIndex >= 0 && depIndex < module.dependencies.length) {
            // Found matching original dependency, get corresponding resolved path
            resolvedPath = module.dependencies[depIndex];
          } else {
            // Fallback: try matching resolved paths directly
            resolvedPath = module.dependencies.find((dep) => {
              let normalizedSource = exp.sourceModule!.replace(/\\/g, '/');
              // Strip common leading prefixes from the source for comparison
              if (normalizedSource.startsWith('./')) {
                normalizedSource = normalizedSource.slice(2);
              } else if (normalizedSource.startsWith('../')) {
                normalizedSource = normalizedSource.slice(3);
              } else if (normalizedSource.startsWith('/')) {
                normalizedSource = normalizedSource.slice(1);
              }

              const normalizedDep = dep.replace(/\\/g, '/');
              // Compare without extensions to handle "./utils" vs "./utils.js"
              const normalizedDepWithoutExt = normalizedDep.replace(/\.[^/.]+$/, '');
              const normalizedSourceWithoutExt = normalizedSource.replace(/\.[^/.]+$/, '');

              return (
                normalizedDep === normalizedSource ||
                normalizedDepWithoutExt === normalizedSourceWithoutExt ||
                normalizedDepWithoutExt.endsWith('/' + normalizedSourceWithoutExt)
              );
            });

            if (!resolvedPath) {
              const hasPathSeparator =
                exp.sourceModule.includes('/') || exp.sourceModule.includes('\\');
              if (!hasPathSeparator) {
                const sourceFileName = exp.sourceModule.split('/').pop() || exp.sourceModule;
                const sourceFileNameWithoutExt = sourceFileName.replace(/\.[^/.]+$/, '');
                resolvedPath = module.dependencies.find((dep) => {
                  const depFileName = (dep.split('/').pop() || dep).replace(/\.[^/.]+$/, '');
                  return depFileName === sourceFileNameWithoutExt;
                });
              }
            }
          }

          if (resolvedPath && graph.has(resolvedPath)) {
            // For re-exports, if this export is used, mark the source export as used
            if (usage.allUsed || usage.used.has(exp.name)) {
              if (exp.name === '*') {
                // export * - all exports from source are used
                await markExportsUsed(resolvedPath, ['*'], true);
              } else {
                // Named re-export - mark the local name as used in source
                const sourceExportName = exp.localName || exp.name;
                await markExportsUsed(resolvedPath, [sourceExportName], false);
              }
            }
          }
        }
      }
    }
  }

  // Start from entry point - all exports from entry are considered used
  await markExportsUsed(entryPath, ['*'], true);

  return usedExports;
}

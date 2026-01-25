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

import type { GraphModule } from './types';

/**
 * Export information extracted from AST
 */
export interface ExportInfo {
  /** Export name (for named exports) */
  name: string;
  /** Whether this is a default export */
  isDefault: boolean;
  /** Whether this is a re-export from another module */
  isReExport: boolean;
  /** Source module path for re-exports */
  sourceModule?: string;
  /** Local name (for re-exports with renaming) */
  localName?: string;
}

/**
 * Import information extracted from AST
 */
export interface ImportInfo {
  /** Import name (for named imports) */
  name: string;
  /** Whether this is a default import */
  isDefault: boolean;
  /** Whether this is a namespace import (import * as X) */
  isNamespace: boolean;
  /** Source module path */
  sourceModule: string;
  /** Local name (for imports with renaming) */
  localName?: string;
}

/**
 * Extract all exports from a module's AST
 */
export async function extractExports(ast: any): Promise<ExportInfo[]> {
  const exports: ExportInfo[] = [];
  const traverse = (await import('@babel/traverse')).default;
  const types = await import('@babel/types');

  traverse(ast, {
    // Named exports: export const foo = ...
    ExportNamedDeclaration(path: any) {
      const { node } = path;

      // export { foo, bar } from './module'
      if (node.source) {
        const source = node.source.value;
        if (typeof source === 'string') {
          for (const spec of node.specifiers || []) {
            if (types.isExportSpecifier(spec)) {
              const exportedName = types.isIdentifier(spec.exported)
                ? spec.exported.name
                : types.isStringLiteral(spec.exported)
                  ? spec.exported.value
                  : (spec.exported as any).name || (spec.exported as any).value || '';
              const localName = types.isIdentifier(spec.local)
                ? spec.local.name
                : types.isStringLiteral(spec.local)
                  ? (spec.local as any).value
                  : (spec.local as any).name || '';
              exports.push({
                name: exportedName,
                isDefault: false,
                isReExport: true,
                sourceModule: source,
                localName,
              });
            }
          }
        }
        return;
      }

      // export { foo, bar } (local exports)
      for (const spec of node.specifiers || []) {
        if (types.isExportSpecifier(spec)) {
          const exportedName = types.isIdentifier(spec.exported)
            ? spec.exported.name
            : types.isStringLiteral(spec.exported)
              ? spec.exported.value
              : (spec.exported as any).name || (spec.exported as any).value || '';
          const localName = types.isIdentifier(spec.local)
            ? spec.local.name
            : types.isStringLiteral(spec.local)
              ? (spec.local as any).value
              : (spec.local as any).name || '';
          exports.push({
            name: exportedName,
            isDefault: false,
            isReExport: false,
            localName,
          });
        }
      }

      // export const foo = ... (declaration export)
      if (node.declaration) {
        if (types.isVariableDeclaration(node.declaration)) {
          for (const declarator of node.declaration.declarations) {
            if (types.isIdentifier(declarator.id)) {
              exports.push({
                name: declarator.id.name,
                isDefault: false,
                isReExport: false,
              });
            } else if (types.isObjectPattern(declarator.id)) {
              // export const { foo, bar } = ...
              for (const prop of declarator.id.properties) {
                if (types.isObjectProperty(prop)) {
                  const key = types.isIdentifier(prop.key)
                    ? prop.key.name
                    : types.isStringLiteral(prop.key)
                      ? prop.key.value
                      : '';
                  if (key) {
                    exports.push({
                      name: key,
                      isDefault: false,
                      isReExport: false,
                    });
                  }
                }
              }
            }
          }
        } else if (types.isFunctionDeclaration(node.declaration)) {
          if (node.declaration.id) {
            exports.push({
              name: node.declaration.id.name,
              isDefault: false,
              isReExport: false,
            });
          }
        } else if (types.isClassDeclaration(node.declaration)) {
          if (node.declaration.id) {
            exports.push({
              name: node.declaration.id.name,
              isDefault: false,
              isReExport: false,
            });
          }
        }
      }
    },

    // Default export: export default ...
    ExportDefaultDeclaration(_path: any) {
      exports.push({
        name: 'default',
        isDefault: true,
        isReExport: false,
      });
    },

    // export * from './module'
    ExportAllDeclaration(path: any) {
      const { node } = path;
      if (node.source) {
        const source = node.source.value;
        if (typeof source === 'string') {
          // For export *, we mark it as a special re-export
          // The actual exports will be resolved from the source module
          exports.push({
            name: '*',
            isDefault: false,
            isReExport: true,
            sourceModule: source,
          });
        }
      }
    },

    // module.exports = ... (CommonJS)
    AssignmentExpression(path: any) {
      const { node } = path;
      if (
        types.isMemberExpression(node.left) &&
        types.isIdentifier(node.left.object) &&
        node.left.object.name === 'module' &&
        types.isIdentifier(node.left.property) &&
        node.left.property.name === 'exports'
      ) {
        // This is a default export in CommonJS
        exports.push({
          name: 'default',
          isDefault: true,
          isReExport: false,
        });
      }
    },
  });

  return exports;
}

/**
 * Extract all imports from a module's AST
 */
export async function extractImports(ast: any): Promise<ImportInfo[]> {
  const imports: ImportInfo[] = [];
  const traverse = (await import('@babel/traverse')).default;
  const types = await import('@babel/types');

  traverse(ast, {
    ImportDeclaration(path: any) {
      const { node } = path;
      const source = node.source.value;
      if (typeof source !== 'string') return;

      for (const spec of node.specifiers || []) {
        if (types.isImportDefaultSpecifier(spec)) {
          imports.push({
            name: 'default',
            isDefault: true,
            isNamespace: false,
            sourceModule: source,
            localName: spec.local.name,
          });
        } else if (types.isImportSpecifier(spec)) {
          const importedName = types.isIdentifier(spec.imported)
            ? spec.imported.name
            : spec.imported.value;
          imports.push({
            name: importedName,
            isDefault: false,
            isNamespace: false,
            sourceModule: source,
            localName: spec.local.name,
          });
        } else if (types.isImportNamespaceSpecifier(spec)) {
          imports.push({
            name: '*',
            isDefault: false,
            isNamespace: true,
            sourceModule: source,
            localName: spec.local.name,
          });
        }
      }
    },

    // require('module') - treat as namespace import
    CallExpression(path: any) {
      const { node } = path;
      const callee = node.callee;

      if (
        types.isIdentifier(callee) &&
        callee.name === 'require' &&
        path.scope &&
        !path.scope.getBinding?.('require')
      ) {
        const arg = node.arguments?.[0];
        if (arg && types.isStringLiteral(arg)) {
          imports.push({
            name: '*',
            isDefault: false,
            isNamespace: true,
            sourceModule: arg.value,
          });
        }
      }
    },
  });

  return imports;
}

/**
 * Track which exports are actually used
 */
export interface UsedExports {
  /** Set of used export names (including 'default') */
  used: Set<string>;
  /** Whether all exports are used (namespace import) */
  allUsed: boolean;
}

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
   */
  async function markExportsUsed(
    modulePath: string,
    exportNames: string[],
    isNamespace: boolean = false,
  ): Promise<void> {
    if (visited.has(modulePath)) {
      // Already visited - merge usage info
      const usage = usedExports.get(modulePath)!;
      if (isNamespace || exportNames.includes('*')) {
        usage.allUsed = true;
      } else {
        for (const name of exportNames) {
          usage.used.add(name);
        }
      }
      return;
    }
    visited.add(modulePath);

    const module = graph.get(modulePath);
    if (!module) return;

    const usage = usedExports.get(modulePath)!;

    if (isNamespace || exportNames.includes('*')) {
      // Namespace import or export * - all exports are used
      usage.allUsed = true;
    } else {
      // Specific exports are used
      for (const name of exportNames) {
        usage.used.add(name);
      }
    }

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
            // Normalize paths for comparison
            const normalizedDep = dep.replace(/\\/g, '/');
            const normalizedSource = imp.sourceModule.replace(/\\/g, '/');

            return (
              normalizedDep === normalizedSource ||
              normalizedDep.endsWith(normalizedSource) ||
              normalizedDep.includes(normalizedSource)
            );
          });

          // If still not found, try matching by filename
          if (!resolvedPath) {
            const sourceFileName = imp.sourceModule.split('/').pop() || imp.sourceModule;
            resolvedPath = module.dependencies.find((dep) => {
              const depFileName = dep.split('/').pop() || dep;
              return depFileName === sourceFileName;
            });
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
              const normalizedDep = dep.replace(/\\/g, '/');
              const normalizedSource = exp.sourceModule!.replace(/\\/g, '/');

              return (
                normalizedDep === normalizedSource ||
                normalizedDep.endsWith(normalizedSource) ||
                normalizedDep.includes(normalizedSource)
              );
            });

            if (!resolvedPath) {
              const sourceFileName = exp.sourceModule.split('/').pop() || exp.sourceModule;
              resolvedPath = module.dependencies.find((dep) => {
                const depFileName = dep.split('/').pop() || dep;
                return depFileName === sourceFileName;
              });
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

/**
 * Remove unused exports from a module's AST
 */
export async function removeUnusedExports(ast: any, usedExports: UsedExports): Promise<any> {
  const traverse = (await import('@babel/traverse')).default;
  const types = await import('@babel/types');

  // Clone AST to avoid mutating original
  const clonedAst = JSON.parse(JSON.stringify(ast));

  traverse(clonedAst, {
    // Remove unused named exports
    ExportNamedDeclaration(path: any) {
      const { node } = path;

      // For re-exports, check if any exports are used
      if (node.source) {
        // Re-export - remove if not used
        // This is simplified - in practice, we'd need to check each specifier
        if (!usedExports.allUsed) {
          const hasUsedSpec = (node.specifiers || []).some((spec: any) => {
            if (types.isExportSpecifier(spec)) {
              const name = types.isIdentifier(spec.exported)
                ? spec.exported.name
                : spec.exported.value;
              return usedExports.used.has(name);
            }
            return false;
          });

          if (!hasUsedSpec) {
            path.remove();
            return;
          }
        }
      } else {
        // Local exports - remove unused specifiers or declaration
        if (!usedExports.allUsed) {
          if (node.declaration) {
            // export const/function/class - check if the declaration is used
            let declarationName: string | null = null;

            if (types.isVariableDeclaration(node.declaration)) {
              const firstDeclarator = node.declaration.declarations[0];
              if (firstDeclarator && types.isIdentifier(firstDeclarator.id)) {
                declarationName = firstDeclarator.id.name;
              } else if (firstDeclarator && types.isObjectPattern(firstDeclarator.id)) {
                // export const { foo, bar } = ... - handle object destructuring
                // For now, keep the export if any property might be used
                // This is a simplified approach
                return; // Keep the export for object destructuring
              }
            } else if (types.isFunctionDeclaration(node.declaration)) {
              declarationName = node.declaration.id?.name || null;
            } else if (types.isClassDeclaration(node.declaration)) {
              declarationName = node.declaration.id?.name || null;
            }

            // If declaration name is not used, remove the export (keep declaration as regular code)
            if (declarationName && !usedExports.used.has(declarationName)) {
              path.replaceWith(node.declaration);
              return;
            }
          } else if (node.specifiers) {
            // export { foo, bar } - remove unused specifiers
            const usedSpecs = node.specifiers.filter((spec: any) => {
              if (types.isExportSpecifier(spec)) {
                const name = types.isIdentifier(spec.exported)
                  ? spec.exported.name
                  : types.isStringLiteral(spec.exported)
                    ? spec.exported.value
                    : (spec.exported as any).name || (spec.exported as any).value || '';
                return usedExports.used.has(name);
              }
              return true; // Keep non-export-specifier nodes
            });

            if (usedSpecs.length === 0) {
              path.remove();
            } else {
              node.specifiers = usedSpecs;
            }
          }
        }
      }
    },

    // Remove unused default export
    ExportDefaultDeclaration(path: any) {
      if (!usedExports.allUsed && !usedExports.used.has('default')) {
        // Convert to regular declaration instead of removing
        // This preserves the code while removing the export
        const { node } = path;
        if (node.declaration) {
          // export default function/class/const - convert to regular declaration
          path.replaceWith(node.declaration);
        } else if (node.expression) {
          // export default expression - remove (expression has no side effects if unused)
          path.remove();
        } else {
          path.remove();
        }
      }
    },

    // Remove unused export * declarations
    ExportAllDeclaration(path: any) {
      if (!usedExports.allUsed && !usedExports.used.has('*')) {
        path.remove();
      }
    },
  });

  return clonedAst;
}

/**
 * Check if a module has side effects
 * Reads package.json to check sideEffects field
 */
async function hasSideEffects(modulePath: string): Promise<boolean> {
  try {
    const { readFileSync, existsSync } = await import('fs');
    const { dirname, join } = await import('path');

    // Find package.json by traversing up from module path
    let currentDir = dirname(modulePath);
    const root = currentDir.split(/[/\\]/)[0] || '/';

    while (currentDir !== root && currentDir !== dirname(currentDir)) {
      const packageJsonPath = join(currentDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          const sideEffects = packageJson.sideEffects;

          // If sideEffects is false, no side effects
          if (sideEffects === false) {
            return false;
          }

          // If sideEffects is an array, check if this file matches
          if (Array.isArray(sideEffects)) {
            const relativePath = modulePath.replace(currentDir + '/', '');
            const hasMatch = sideEffects.some((pattern: string) => {
              // Simple glob pattern matching (supports * and **)
              const regex = new RegExp(
                pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\./g, '\\.'),
              );
              return regex.test(relativePath) || regex.test(modulePath);
            });
            return hasMatch; // If matches, has side effects
          }

          // Default: assume side effects exist (safe default)
          return true;
        } catch {
          // Invalid JSON, assume side effects
          return true;
        }
      }
      currentDir = dirname(currentDir);
    }

    // No package.json found, assume side effects (safe default)
    return true;
  } catch {
    // Error reading, assume side effects (safe default)
    return true;
  }
}

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

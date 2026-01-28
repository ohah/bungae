/**
 * Remove Unused Exports
 *
 * Removes unused exports from a module's AST
 */

import type { UsedExports } from './types';

/**
 * Remove unused exports from a module's AST
 */
export async function removeUnusedExports(ast: any, usedExports: UsedExports): Promise<any> {
  const traverse = (await import('@babel/traverse')).default;
  const types = await import('@babel/types');
  const { cloneNode } = await import('@babel/types');

  // Clone AST to avoid mutating original. Use Babel's cloneNode to preserve metadata and prototypes.
  const clonedAst = cloneNode(ast, /* deep */ true);

  traverse(clonedAst, {
    // Remove unused CommonJS exports (exports.foo = ... / exports['foo'] = ...)
    // This handles Babel-transformed code where ESM exports become exports.foo = ...
    AssignmentExpression(path: any) {
      const { node } = path;

      // exports.foo = ... / exports['foo'] = ... (named export - Babel transformed)
      if (
        types.isMemberExpression(node.left) &&
        types.isIdentifier(node.left.object) &&
        node.left.object.name === 'exports'
      ) {
        let exportName: string | null = null;

        // Static property: exports.foo
        if (!node.left.computed && types.isIdentifier(node.left.property)) {
          exportName = node.left.property.name;
        }
        // String-literal property: exports['foo']
        else if (node.left.computed && types.isStringLiteral(node.left.property)) {
          exportName = node.left.property.value;
        }
        // Dynamic / unknown key: exports[expr] where expr is not a simple string literal
        else {
          // Be conservative: unknown exports are present, so keep all exports
          usedExports.allUsed = true;
          return;
        }

        // If this export is not used, remove it
        if (exportName && !usedExports.allUsed && !usedExports.used.has(exportName)) {
          path.remove();
        }
      }
    },

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
                const pattern = firstDeclarator.id;
                const exportedNames: string[] = [];

                // Collect all local binding names from the destructuring pattern
                for (const prop of pattern.properties) {
                  if (types.isObjectProperty(prop)) {
                    const value = (prop as any).value;
                    if (types.isIdentifier(value)) {
                      exportedNames.push(value.name);
                    } else if (types.isAssignmentPattern(value) && types.isIdentifier(value.left)) {
                      exportedNames.push(value.left.name);
                    }
                  } else if (types.isRestElement(prop) && types.isIdentifier(prop.argument)) {
                    exportedNames.push(prop.argument.name);
                  }
                }

                const hasUsedExport = exportedNames.some((name) => usedExports.used.has(name));
                if (!hasUsedExport) {
                  // None of the destructured bindings are used as exports.
                  // Preserve potential side effects of the initializer by keeping
                  // the declaration but removing the export wrapper.
                  path.replaceWith(node.declaration);
                  return;
                }
                // Some (or all) of the destructured bindings are used as exports.
                // For now we keep the entire destructuring export, since selectively
                // removing individual properties is more complex to do safely.
                return;
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
          // export default expression - keep expression, drop export to preserve side effects
          // Expressions like someFunction() or new MyClass() may have side effects
          path.replaceWith(types.expressionStatement(node.expression));
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

    // Remove unused Object.defineProperty(exports, 'foo', ...) (Babel helper)
    CallExpression(path: any) {
      const { node } = path;

      if (
        types.isMemberExpression(node.callee) &&
        types.isIdentifier(node.callee.object) &&
        node.callee.object.name === 'Object' &&
        types.isIdentifier(node.callee.property) &&
        node.callee.property.name === 'defineProperty' &&
        node.arguments.length >= 2 &&
        types.isIdentifier(node.arguments[0]) &&
        node.arguments[0].name === 'exports' &&
        types.isStringLiteral(node.arguments[1])
      ) {
        const exportName = node.arguments[1].value;

        // If this export is not used, remove it
        if (!usedExports.allUsed && !usedExports.used.has(exportName)) {
          path.remove();
        }
      }
    },
  });

  return clonedAst;
}

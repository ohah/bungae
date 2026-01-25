/**
 * Extract Imports from AST
 *
 * Extracts all import declarations from a module's AST
 */

import type { ImportInfo } from './types';

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

    // require('module') - treat as namespace import or destructured import
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
          // Check if require() result is destructured: const { foo, bar } = require('./utils')
          const parent = path.parent;
          if (types.isVariableDeclarator(parent) && types.isObjectPattern(parent.id)) {
            // Extract specific property names from destructuring pattern
            const propertyNames: string[] = [];
            for (const prop of parent.id.properties) {
              if (types.isObjectProperty(prop)) {
                const value = (prop as any).value;
                if (types.isIdentifier(value)) {
                  propertyNames.push(value.name);
                } else if (types.isAssignmentPattern(value) && types.isIdentifier(value.left)) {
                  propertyNames.push(value.left.name);
                }
              } else if (types.isRestElement(prop) && types.isIdentifier(prop.argument)) {
                // Rest element means all exports are used
                propertyNames.push('*');
              }
            }

            if (propertyNames.includes('*')) {
              // Rest element or namespace import - all exports used
              imports.push({
                name: '*',
                isDefault: false,
                isNamespace: true,
                sourceModule: arg.value,
              });
            } else {
              // Specific named imports
              for (const name of propertyNames) {
                imports.push({
                  name,
                  isDefault: false,
                  isNamespace: false,
                  sourceModule: arg.value,
                });
              }
            }
          } else {
            // Not destructured - treat as namespace import
            imports.push({
              name: '*',
              isDefault: false,
              isNamespace: true,
              sourceModule: arg.value,
            });
          }
        }
      }
    },
  });

  return imports;
}

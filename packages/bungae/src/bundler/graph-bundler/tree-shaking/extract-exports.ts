/**
 * Extract Exports from AST
 *
 * Extracts all export declarations from a module's AST
 */

import type { ExportInfo } from './types';

/**
 * Extract all exports from a module's AST
 */
export async function extractExports(ast: any): Promise<ExportInfo[]> {
  const exports: ExportInfo[] = [];
  const traverse = (await import('@babel/traverse')).default;
  const types = await import('@babel/types');

  traverse(ast, {
    // Named exports: export const foo = ...
    // Note: TypeScript type-only exports (export type, export interface) are typically
    // stripped during Babel transformation, so they shouldn't appear here. If they do,
    // they will be skipped as they won't match any of the patterns below.
    ExportNamedDeclaration(path: any) {
      const { node } = path;

      // export { foo, bar } from './module'
      if (node.source) {
        const source = node.source.value;
        if (typeof source === 'string') {
          for (const spec of node.specifiers || []) {
            if (types.isExportSpecifier(spec)) {
              let exportedName: string | undefined;
              if (types.isIdentifier(spec.exported)) {
                exportedName = spec.exported.name;
              } else if (types.isStringLiteral(spec.exported)) {
                exportedName = (spec.exported as any).value;
              } else {
                // Unexpected AST shape: skip this export specifier rather than using an empty name
                console.warn(
                  '[tree-shaking] Unexpected "exported" node type in ExportSpecifier:',
                  (spec.exported && (spec.exported as any).type) || typeof spec.exported,
                );
                continue;
              }

              let localName: string | undefined;
              if (types.isIdentifier(spec.local)) {
                localName = spec.local.name;
              } else if (types.isStringLiteral(spec.local)) {
                localName = (spec.local as any).value;
              }

              if (exportedName) {
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
        }
        return;
      }

      // export { foo, bar } (local exports)
      for (const spec of node.specifiers || []) {
        if (types.isExportSpecifier(spec)) {
          let exportedName: string | undefined;
          if (types.isIdentifier(spec.exported)) {
            exportedName = spec.exported.name;
          } else if (types.isStringLiteral(spec.exported)) {
            exportedName = spec.exported.value;
          } else {
            // Unexpected AST shape: skip this export specifier rather than using an empty name
            console.warn(
              '[tree-shaking] Unexpected "exported" node type in ExportSpecifier:',
              (spec.exported && (spec.exported as any).type) || typeof spec.exported,
            );
            continue;
          }

          let localName: string | undefined;
          if (types.isIdentifier(spec.local)) {
            localName = spec.local.name;
          } else if (types.isStringLiteral(spec.local)) {
            localName = (spec.local as any).value;
          }

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
              // export const { foo, bar } = ... or export const { foo: bar, ...rest } = ...
              for (const prop of declarator.id.properties) {
                if (types.isObjectProperty(prop)) {
                  // Support renamed properties: export const { foo: bar } = ...
                  // The exported name is the value (bar), not the key (foo)
                  const exportedName = types.isIdentifier(prop.value)
                    ? prop.value.name
                    : types.isIdentifier(prop.key)
                      ? prop.key.name
                      : types.isStringLiteral(prop.key)
                        ? (prop.key as any).value
                        : '';
                  if (exportedName) {
                    exports.push({
                      name: exportedName,
                      isDefault: false,
                      isReExport: false,
                    });
                  }
                } else if (types.isRestElement(prop) && types.isIdentifier(prop.argument)) {
                  // Support rest elements: export const { foo, ...rest } = ...
                  exports.push({
                    name: prop.argument.name,
                    isDefault: false,
                    isReExport: false,
                  });
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

    // module.exports = ... (CommonJS default export)
    // exports.foo = ... (CommonJS named export - Babel transformed)
    AssignmentExpression(path: any) {
      const { node } = path;

      // module.exports = ... (default export)
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
        return;
      }

      // exports.foo = ... (named export - Babel transformed from ESM)
      if (
        types.isMemberExpression(node.left) &&
        types.isIdentifier(node.left.object) &&
        node.left.object.name === 'exports' &&
        types.isIdentifier(node.left.property)
      ) {
        // This is a named export in CommonJS (Babel transformed)
        exports.push({
          name: node.left.property.name,
          isDefault: false,
          isReExport: false,
        });
      }
    },
  });

  return exports;
}

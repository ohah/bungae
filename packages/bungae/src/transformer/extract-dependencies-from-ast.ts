/**
 * Extract dependencies from Babel AST (Metro-compatible)
 *
 * Metro uses @babel/traverse to walk the AST and find require()/import() calls.
 * This implementation matches Metro's collectDependencies behavior.
 */

/**
 * Extract dependencies from Babel AST
 * Metro-compatible: uses AST traversal instead of generating code
 */
export async function extractDependenciesFromAst(ast: any): Promise<string[]> {
  const dependencies = new Set<string>();

  // Import @babel/traverse and @babel/types dynamically (Metro-compatible)
  const traverse = (await import('@babel/traverse')).default;
  const types = await import('@babel/types');

  // Babel transformFromAstAsync returns File node (has program property)
  // traverse can handle File node directly - it automatically traverses program
  // Metro passes File node directly to collectDependencies
  traverse(ast, {
    // Import declarations: import X from 'module'
    ImportDeclaration(path: any) {
      const source = path.node?.source;
      if (source && source.type === 'StringLiteral' && typeof source.value === 'string') {
        dependencies.add(source.value);
      }
    },

    // Export declarations: export { X } from 'module', export * from 'module'
    ExportNamedDeclaration(path: any) {
      const source = path.node?.source;
      if (source && source.type === 'StringLiteral' && typeof source.value === 'string') {
        dependencies.add(source.value);
      }
    },

    ExportAllDeclaration(path: any) {
      const source = path.node?.source;
      if (source && source.type === 'StringLiteral' && typeof source.value === 'string') {
        dependencies.add(source.value);
      }
    },

    // Dynamic import: import('module')
    CallExpression(path: any) {
      const { node } = path;
      const callee = node?.callee;

      // import('module') - Metro uses isImport() from @babel/types
      if (callee && types.isImport(callee)) {
        const arg = node.arguments?.[0];
        if (arg && arg.type === 'StringLiteral' && typeof arg.value === 'string') {
          dependencies.add(arg.value);
        }
        return;
      }

      // require('module')
      if (
        callee &&
        callee.type === 'Identifier' &&
        callee.name === 'require' &&
        path.scope &&
        !path.scope.getBinding?.('require')
      ) {
        const arg = node.arguments?.[0];
        if (arg && arg.type === 'StringLiteral' && typeof arg.value === 'string') {
          dependencies.add(arg.value);
        }
      }
    },
  });

  // Filter out Flow file imports and empty strings
  const filtered = Array.from(dependencies)
    .filter((dep) => {
      if (dep.endsWith('.flow') || dep.endsWith('.flow.js')) {
        return false;
      }
      if (!dep || !dep.trim()) {
        return false;
      }
      return true;
    })
    .map((dep) => dep.trim());

  return Array.from(new Set(filtered));
}

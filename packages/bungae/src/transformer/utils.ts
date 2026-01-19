/**
 * Transformer Utilities
 * Using SWC for all transformations and dependency extraction
 */

/**
 * Get loader from file extension
 */
export function getLoader(filePath: string): 'tsx' | 'ts' | 'jsx' | 'js' {
  if (filePath.endsWith('.tsx')) return 'tsx';
  if (filePath.endsWith('.ts')) return 'ts';
  if (filePath.endsWith('.jsx')) return 'jsx';
  return 'js';
}

/**
 * Check if code contains Flow syntax
 */
async function hasFlowSyntax(code: string, filePath?: string): Promise<boolean> {
  const { hasFlowSyntax: hasFlowSyntaxAST } = await import('./swc-transformer');
  return hasFlowSyntaxAST(code, filePath);
}

/**
 * Strip Flow types using Babel with Hermes parser
 */
async function stripFlowTypes(code: string, filePath?: string): Promise<string> {
  const { stripFlowTypesWithBabel } = await import('./swc-transformer');
  return stripFlowTypesWithBabel(code, filePath);
}

/**
 * Transform code with SWC (handles JSX, TypeScript, etc.)
 */
async function transformWithSwc(code: string, filePath?: string): Promise<string> {
  const { transformWithSwcCore } = await import('./swc-transformer');
  return transformWithSwcCore(code, filePath || 'file.js', { dev: false });
}

/**
 * Extract dependencies from source code using SWC parser
 *
 * For Flow files, strips Flow types first with Babel.
 * Then uses SWC to transform and parse.
 */
export async function extractDependencies(code: string, filePath?: string): Promise<string[]> {
  let processedCode = code;

  // Check for Flow syntax - use Babel to strip Flow types first
  const hasFlow = await hasFlowSyntax(code, filePath);
  if (hasFlow) {
    processedCode = await stripFlowTypes(code, filePath);
  }

  // Transform code with SWC (handles JSX, TypeScript, ESM)
  // SWC will handle JSX transformation automatically
  processedCode = await transformWithSwc(processedCode, filePath);

  // Use SWC parser for AST-based dependency extraction
  return extractDependenciesWithSwc(processedCode, filePath);
}

/**
 * Extract dependencies using SWC AST parser
 */
async function extractDependenciesWithSwc(code: string, filePath?: string): Promise<string[]> {
  const swc = await import('@swc/core');
  const dependencies: string[] = [];

  // Parse the code to get AST
  let ast;
  try {
    ast = await swc.parse(code, {
      syntax: 'ecmascript', // After SWC transform, code is plain JS
      target: 'es2015',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const codePreview = code.substring(0, 1000);
    throw new Error(
      `Failed to parse code with SWC: ${errorMsg}\n` +
        `File: ${filePath || 'unknown'}\n` +
        `Code preview (first 1000 chars):\n${codePreview}`,
    );
  }

  // Walk AST to extract dependencies
  if (ast && ast.body) {
    for (const stmt of ast.body) {
      // Import declarations: import X from 'module'
      if (stmt.type === 'ImportDeclaration' && stmt.source) {
        const source = stmt.source;
        if (source.type === 'StringLiteral' && source.value) {
          dependencies.push(source.value);
        }
      }

      // Export declarations: export { X } from 'module', export * from 'module'
      if (
        (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportAllDeclaration') &&
        stmt.source
      ) {
        const source = stmt.source;
        if (source.type === 'StringLiteral' && source.value) {
          dependencies.push(source.value);
        }
      }
    }

    // Walk AST for dynamic imports and require calls
    walkASTForDependencies(ast.body, dependencies);
  }

  // Filter out Flow file imports
  const filtered = dependencies
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

/**
 * Walk AST to find dynamic imports and require calls
 */
function walkASTForDependencies(nodes: any[], dependencies: string[]): void {
  for (const node of nodes) {
    walkNode(node, dependencies);
  }
}

function walkNode(node: any, dependencies: string[]): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  // Dynamic import: import('module')
  if (node.type === 'CallExpression') {
    const callee = node.callee;

    // import('module')
    if (callee && callee.type === 'Import') {
      const args = node.arguments;
      if (args && args.length > 0) {
        const arg = args[0];
        if (arg.expression && arg.expression.type === 'StringLiteral' && arg.expression.value) {
          dependencies.push(arg.expression.value);
        }
      }
    }

    // require('module')
    if (callee && callee.type === 'Identifier' && callee.value === 'require') {
      const args = node.arguments;
      if (args && args.length > 0) {
        const arg = args[0];
        if (arg.expression && arg.expression.type === 'StringLiteral' && arg.expression.value) {
          dependencies.push(arg.expression.value);
        }
      }
    }
  }

  // Recursively walk all properties
  for (const key in node) {
    if (key === 'span') {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      walkASTForDependencies(value, dependencies);
    } else if (value && typeof value === 'object') {
      walkNode(value, dependencies);
    }
  }
}

/**
 * Transformer Utilities
 * Using Babel + Hermes for Flow, SWC for parsing
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
 * Uses @flow pragma comment as primary indicator (Metro-compatible)
 */
function hasFlowSyntax(code: string): boolean {
  return /@flow/.test(code) || /@noflow/.test(code);
}

/**
 * Strip Flow types using Babel with Hermes parser (Metro-compatible)
 */
async function stripFlowTypes(code: string, filePath?: string): Promise<string> {
  const babel = await import('@babel/core');
  const hermesParser = await import('hermes-parser');
  const flowPlugin = await import('@babel/plugin-transform-flow-strip-types');

  // Parse with Hermes parser (like Metro does)
  const sourceAst = hermesParser.parse(code, {
    babel: true,
    sourceType: 'module',
  });

  // Transform AST with Babel (Flow type stripping)
  const result = babel.transformFromAstSync(sourceAst, code, {
    ast: true,
    babelrc: false,
    configFile: false,
    filename: filePath || 'file.js',
    sourceType: 'module',
    plugins: [[flowPlugin.default]],
  });

  if (!result?.code || result.code.trim() === '') {
    return 'export {};';
  }

  return result.code;
}

/**
 * Extract dependencies from source code using SWC parser
 *
 * For Flow files, strips Flow types first with Babel.
 * For TypeScript files, parses with TypeScript syntax.
 * Dependencies are extracted from the original code before transformation
 * to preserve type-only imports (which are still dependencies for bundling).
 */
export async function extractDependencies(code: string, filePath?: string): Promise<string[]> {
  let processedCode = code;

  // Check for Flow syntax - use Babel to strip Flow types first
  const hasFlow = hasFlowSyntax(code);
  if (hasFlow) {
    processedCode = await stripFlowTypes(code, filePath);
  }

  // Parse and extract dependencies from original/flow-stripped code
  // Do NOT transform with SWC first, as that removes type imports
  // which are still dependencies for bundling purposes
  return extractDependenciesWithSwc(processedCode, filePath);
}

/**
 * Extract dependencies using SWC AST parser
 */
async function extractDependenciesWithSwc(code: string, filePath?: string): Promise<string[]> {
  const swc = await import('@swc/core');
  const dependencies: string[] = [];

  // Detect syntax from file extension or code content
  const isTS =
    filePath?.endsWith('.ts') ||
    filePath?.endsWith('.tsx') ||
    /\bimport\s+type\b/.test(code) ||
    /\bexport\s+type\b/.test(code);
  const isJSX =
    filePath?.endsWith('.tsx') ||
    filePath?.endsWith('.jsx') ||
    /<[A-Z][a-zA-Z0-9.]*[\s/>]|<[a-z]+[\s/>]|<\/[A-Z]|<\/[a-z]/.test(code);

  // Build parser config based on detected syntax
  const parserConfig: {
    syntax: 'typescript' | 'ecmascript';
    tsx?: boolean;
    jsx?: boolean;
  } = {
    syntax: isTS ? 'typescript' : 'ecmascript',
  };

  if (isJSX) {
    if (isTS) {
      parserConfig.tsx = true;
    } else {
      parserConfig.jsx = true;
    }
  }

  // Parse the code to get AST
  let ast;
  try {
    ast = await swc.parse(code, {
      ...parserConfig,
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
function walkASTForDependencies(nodes: unknown[], dependencies: string[]): void {
  for (const node of nodes) {
    walkNode(node, dependencies);
  }
}

function walkNode(node: unknown, dependencies: string[]): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  const n = node as Record<string, unknown>;

  // Dynamic import: import('module')
  if (n.type === 'CallExpression') {
    const callee = n.callee as Record<string, unknown> | undefined;

    // import('module')
    if (callee && callee.type === 'Import') {
      const args = n.arguments as Array<Record<string, unknown>> | undefined;
      if (args && args.length > 0) {
        const arg = args[0];
        const expr = arg?.expression as Record<string, unknown> | undefined;
        if (expr && expr.type === 'StringLiteral' && typeof expr.value === 'string') {
          dependencies.push(expr.value);
        }
      }
    }

    // require('module')
    if (callee && callee.type === 'Identifier' && callee.value === 'require') {
      const args = n.arguments as Array<Record<string, unknown>> | undefined;
      if (args && args.length > 0) {
        const arg = args[0];
        const expr = arg?.expression as Record<string, unknown> | undefined;
        if (expr && expr.type === 'StringLiteral' && typeof expr.value === 'string') {
          dependencies.push(expr.value);
        }
      }
    }
  }

  // Recursively walk all properties
  for (const key in n) {
    if (key === 'span') {
      continue;
    }
    const value = n[key];
    if (Array.isArray(value)) {
      walkASTForDependencies(value, dependencies);
    } else if (value && typeof value === 'object') {
      walkNode(value, dependencies);
    }
  }
}

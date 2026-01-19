/**
 * Transformer Utilities
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
function hasFlowSyntax(code: string): boolean {
  // Check for @flow comment
  if (/@flow/.test(code)) return true;
  // Check for import typeof
  if (/import\s+typeof/.test(code)) return true;
  // Check for variable type annotations like: const x: Type = or let x: Type =
  if (/\b(const|let|var)\s+\w+\s*:\s*\{/.test(code)) return true;
  return false;
}

/**
 * Strip Flow types using Babel with Hermes parser (like Metro does)
 * Hermes parser properly handles all Flow syntax including `import typeof` and `} as Type`
 */
async function stripFlowTypes(code: string, filePath?: string): Promise<string> {
  const babel = await import('@babel/core');
  // Import plugins directly to avoid Babel's resolution from CWD
  const hermesParserPlugin = await import('babel-plugin-syntax-hermes-parser');
  const flowPlugin = await import('@babel/plugin-transform-flow-strip-types');

  const result = await babel.transformAsync(code, {
    filename: filePath || 'file.js',
    plugins: [
      // Hermes parser FIRST - it replaces Babel's parser with hermes-parser
      // which properly handles all Flow syntax
      [hermesParserPlugin.default, { parseLangTypes: 'flow' }],
      // Then strip Flow types
      [flowPlugin.default],
    ],
    // Don't modify anything else, just strip Flow types
    babelrc: false,
    configFile: false,
  });

  return result?.code || code;
}

/**
 * Check if code contains JSX syntax
 */
function hasJSXSyntax(code: string): boolean {
  // Check for JSX elements: <Component or <div
  // Avoid matching less-than comparisons by requiring capital letter or lowercase followed by attributes
  return /<[A-Z][a-zA-Z0-9.]*[\s/>]|<[a-z]+[\s/>]/.test(code);
}

/**
 * Extract dependencies from source code using AST (oxc)
 * This should be called on the original code (before transformation)
 *
 * Metro uses AST-based extraction. We use oxc for accurate AST parsing.
 * For JSX files, we use oxc-transform to transform JSX to JavaScript first,
 * then extract dependencies from the transformed code.
 * For Flow files, we use Babel to strip Flow types first (like Metro does).
 */
export async function extractDependencies(
  code: string,
  filePath?: string,
): Promise<string[]> {
  let processedCode = code;

  // Check for Flow syntax - use Babel to strip Flow types first
  // Flow syntax like `import typeof`, `@flow` comment, inline type annotations
  // cannot be parsed by oxc-parser, so we use Babel (like Metro does)
  if (hasFlowSyntax(code)) {
    processedCode = await stripFlowTypes(code, filePath);
  }

  // Check if code contains JSX (either by extension or by content)
  // React Native .js files can contain JSX
  const hasJSX =
    (filePath && (filePath.endsWith('.jsx') || filePath.endsWith('.tsx'))) ||
    hasJSXSyntax(processedCode);

  // For files with JSX, use oxc-transform to transform JSX to JavaScript first
  // This allows us to extract dependencies from the transformed code
  // Metro extracts dependencies from original code, but oxc-parser can't parse JSX
  // So we transform JSX first, then extract dependencies
  if (hasJSX) {
    try {
      const oxcTransform = await import('oxc-transform');
      // Use .jsx extension to enable JSX parsing in oxc-transform
      // oxc-transform determines JSX support based on file extension
      const jsxFilePath = filePath
        ? filePath.replace(/\.(js|ts)$/, (m) => (m === '.ts' ? '.tsx' : '.jsx'))
        : 'file.jsx';
      // Transform JSX to JavaScript using automatic runtime
      // This converts JSX to function calls, making it parseable
      const transformed = oxcTransform.transformSync(jsxFilePath, processedCode, {
        jsx: {
          runtime: 'automatic',
          development: false,
        },
      });

      // If transformation succeeded and has code, extract from transformed code
      if (transformed.code && !transformed.errors?.length) {
        processedCode = transformed.code;
      }
    } catch {
      // If oxc-transform fails, fall through to oxc-parser
      // It will handle the error in extractDependenciesWithOxc
    }
  }

  // Use oxc-parser for AST-based dependency extraction
  const oxcParser = await import('oxc-parser');

  if (!oxcParser) {
    throw new Error('oxc-parser is required for dependency extraction');
  }

  return extractDependenciesWithOxc(processedCode, oxcParser);
}

/**
 * Extract dependencies using oxc AST parser
 */
function extractDependenciesWithOxc(
  code: string,
  oxcParser: any,
): string[] {
  const dependencies: string[] = [];
  
  // Determine source type based on code content
  // Try to detect if it's a module (has imports/exports) or script
  // Also check for async/await which requires module context
  const hasImports = /^\s*(import|export)\s/.test(code) || /import\s+.*\s+from/.test(code);
  const hasAsyncAwait = /\bawait\b/.test(code) || /\basync\s+function\b/.test(code);
  const isModule = hasImports || hasAsyncAwait;
  
  // Parse the code to get AST
  // oxc-parser 0.108.0 API: parseSync(source, options?) or parseSync(filename, source, options?)
  let result;
  try {
    // Try different API signatures for oxc-parser
    if (typeof oxcParser.parseSync === 'function') {
      // Try with filename first (some versions require it)
      try {
        result = oxcParser.parseSync('file.ts', code, {
          sourceType: isModule ? 'module' : 'script',
        });
      } catch {
        // Fallback: try without filename
        result = oxcParser.parseSync(code, {
          sourceType: isModule ? 'module' : 'script',
        });
      }
    } else if (typeof oxcParser.parse === 'function') {
      result = oxcParser.parse(code, {
        sourceType: isModule ? 'module' : 'script',
      });
    } else {
      throw new Error('oxc-parser does not have parseSync or parse method');
    }
  } catch (error) {
    // If parsing fails, throw error
    // JSX files should have been transformed by oxc-transform before reaching here
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse code with oxc-parser: ${errorMsg}`);
  }
  
  if (result.errors && result.errors.length > 0) {
    // If parsing has errors, throw
    // JSX files should have been transformed by oxc-transform before reaching here
    const errorMessages = result.errors.map((e: any) => e.message || String(e)).join(', ');
    throw new Error(`Failed to parse code with oxc-parser: ${errorMessages}`);
  }
  
  const ast = result.program;
  const moduleInfo = result.module;
  
  // Extract static imports from moduleInfo
  // oxc-parser provides module.staticImports array
  if (moduleInfo?.staticImports && Array.isArray(moduleInfo.staticImports)) {
    for (const imp of moduleInfo.staticImports) {
      // Handle different possible structures
      if (typeof imp === 'string') {
        dependencies.push(imp);
      } else if (imp && typeof imp === 'object') {
        // Try imp.source (StringLiteral)
        if (imp.source) {
          if (typeof imp.source === 'string') {
            dependencies.push(imp.source);
          } else if (imp.source.value && typeof imp.source.value === 'string') {
            dependencies.push(imp.source.value);
          } else if (imp.source.raw && typeof imp.source.raw === 'string') {
            // Remove quotes from raw string
            const raw = imp.source.raw;
            const cleaned = raw.replace(/^['"]|['"]$/g, '');
            dependencies.push(cleaned);
          }
        }
      }
    }
  }
  
  // Also walk AST to find ImportDeclaration nodes directly
  // This is more reliable than relying on moduleInfo
  // Metro does this by walking the AST directly
  if (ast && ast.body && Array.isArray(ast.body)) {
    for (const stmt of ast.body) {
      if (stmt.type === 'ImportDeclaration' && stmt.source) {
        if (typeof stmt.source === 'string') {
          dependencies.push(stmt.source);
        } else if (stmt.source.value && typeof stmt.source.value === 'string') {
          dependencies.push(stmt.source.value);
        } else if (stmt.source.raw && typeof stmt.source.raw === 'string') {
          const raw = stmt.source.raw;
          const cleaned = raw.replace(/^['"]|['"]$/g, '');
          dependencies.push(cleaned);
        }
      }
    }
  }
  
  // Extract dynamic imports
  if (moduleInfo?.dynamicImports && Array.isArray(moduleInfo.dynamicImports)) {
    for (const imp of moduleInfo.dynamicImports) {
      // Dynamic imports might be expressions, extract string literals
      if (typeof imp === 'string') {
        dependencies.push(imp);
      } else if (imp && typeof imp === 'object') {
        if (imp.argument) {
          const arg = imp.argument;
          if (arg.type === 'StringLiteral' && arg.value) {
            dependencies.push(arg.value);
          } else if (typeof arg === 'string') {
            dependencies.push(arg);
          } else if (arg.value && typeof arg.value === 'string') {
            dependencies.push(arg.value);
          } else if (arg.raw && typeof arg.raw === 'string') {
            // Remove quotes from raw string
            const raw = arg.raw;
            const cleaned = raw.replace(/^['"]|['"]$/g, '');
            dependencies.push(cleaned);
          }
        }
      }
    }
  }
  
  // Also walk AST to find ImportExpression nodes (dynamic imports)
  // Metro does this by walking the AST directly
  if (ast) {
    walkASTForDynamicImports(ast, dependencies);
  }
  
  // Extract require() calls by walking the AST
  // This is important for CommonJS modules
  // Metro does this by walking the AST directly
  if (ast) {
    walkASTForRequires(ast, dependencies);
  }
  
  // Filter out Flow file imports and type-only imports
  const filtered = dependencies
    .filter((dep) => {
      // Skip Flow files
      if (dep.endsWith('.flow') || dep.endsWith('.flow.js')) {
        return false;
      }
      // Skip empty strings
      if (!dep || !dep.trim()) {
        return false;
      }
      return true;
    })
    .map((dep) => dep.trim());

  return [...new Set(filtered)];
}

/**
 * Walk AST to find dynamic import() calls
 * Metro extracts these by walking the AST
 */
function walkASTForDynamicImports(node: any, dependencies: string[]): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  
  // Check if this is an ImportExpression (dynamic import)
  if (node.type === 'ImportExpression' || node.type === 'CallExpression') {
    // Check if it's import(...)
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (callee && callee.type === 'Import') {
        // import(...)
        const arg = node.arguments?.[0];
        if (arg && arg.type === 'StringLiteral' && arg.value) {
          dependencies.push(arg.value);
        } else if (arg && arg.raw && typeof arg.raw === 'string') {
          const raw = arg.raw;
          const cleaned = raw.replace(/^['"]|['"]$/g, '');
          dependencies.push(cleaned);
        }
      }
    } else if (node.type === 'ImportExpression') {
      // Direct ImportExpression
      const source = node.source;
      if (source && source.type === 'StringLiteral' && source.value) {
        dependencies.push(source.value);
      } else if (source && source.raw && typeof source.raw === 'string') {
        const raw = source.raw;
        const cleaned = raw.replace(/^['"]|['"]$/g, '');
        dependencies.push(cleaned);
      }
    }
  }
  
  // Recursively walk all properties
  for (const key in node) {
    if (key === 'parent' || key === 'span') {
      continue; // Skip circular references
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        walkASTForDynamicImports(item, dependencies);
      }
    } else if (value && typeof value === 'object') {
      walkASTForDynamicImports(value, dependencies);
    }
  }
}

/**
 * Walk AST to find require() calls
 * Metro extracts these by walking the AST
 */
function walkASTForRequires(node: any, dependencies: string[]): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  
  // Check if this is a CallExpression with require()
  if (node.type === 'CallExpression') {
    const callee = node.callee;
    if (
      callee &&
      (callee.type === 'Identifier' || callee.type === 'IdentifierReference') &&
      callee.name === 'require'
    ) {
      const args = node.arguments;
      if (args && args.length > 0) {
        const arg = args[0];
        if (arg.type === 'StringLiteral' && arg.value) {
          dependencies.push(arg.value);
        } else if (arg.raw && typeof arg.raw === 'string') {
          // Handle raw string literals
          const raw = arg.raw;
          const cleaned = raw.replace(/^['"]|['"]$/g, '');
          dependencies.push(cleaned);
        }
      }
    }
  }
  
  // Recursively walk all properties
  for (const key in node) {
    if (key === 'parent' || key === 'span') {
      continue; // Skip circular references
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        walkASTForRequires(item, dependencies);
      }
    } else if (value && typeof value === 'object') {
      walkASTForRequires(value, dependencies);
    }
  }
}

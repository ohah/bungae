/**
 * Oxc Transformer - Main transformer using oxc-transform for all code transformations
 */

import type { TransformOptions, TransformResult } from './types';
import { extractDependencies } from './utils';

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
  // Check for Flow type cast: } as Type;
  if (/\}\s+as\s+\w+;/.test(code)) return true;
  return false;
}

/**
 * Metro transformation order:
 * 1. Hermes Parser Plugin - Parses Flow + JSX syntax (Babel only)
 * 2. Flow Enum Transform - Handles Flow enums (Babel only)
 * 3. Flow Type Stripping - Removes Flow type annotations (Babel only)
 * 4. ESM → CJS Conversion - import → require (SWC - fast)
 * 5. JSX Transformation - <Component /> → jsx() (SWC/OXC - fast)
 *
 * Flow-related steps require Babel (Hermes parser).
 * ESM→CJS and JSX can use SWC for better performance.
 */

/**
 * Step 1-3: Strip Flow types using Babel with Hermes parser
 * Only Babel can handle Flow syntax properly.
 */
async function stripFlowTypesWithBabel(code: string, filePath?: string): Promise<string> {
  const babel = await import('@babel/core');
  const hermesParserPlugin = await import('babel-plugin-syntax-hermes-parser');
  const flowPlugin = await import('@babel/plugin-transform-flow-strip-types');

  const result = await babel.transformAsync(code, {
    filename: filePath || 'file.js',
    plugins: [
      // 1. Hermes parser - handles Flow + JSX syntax
      [hermesParserPlugin.default, { parseLangTypes: 'flow' }],
      // 2-3. Flow type stripping (includes enum handling)
      [flowPlugin.default],
    ],
    babelrc: false,
    configFile: false,
  });

  return result?.code || code;
}

/**
 * Step 4: ESM → CJS conversion using SWC
 * SWC is faster than Babel for module transformation.
 */
async function convertEsmToCjsWithSwc(
  code: string,
  filePath: string,
  options: { dev: boolean },
): Promise<string> {
  const swc = await import('@swc/core');
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  const isJSX = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');

  const result = await swc.transform(code, {
    filename: filePath,
    jsc: {
      parser: {
        syntax: isTS ? 'typescript' : 'ecmascript',
        tsx: isJSX,
        jsx: !isTS && isJSX,
      },
      target: 'es2015',
    },
    module: {
      type: 'commonjs',
      strict: false,
      strictMode: false,
      lazy: false,
      noInterop: false,
    },
    isModule: true,
    sourceMaps: false,
    configFile: false,
    swcrc: false,
  });

  return result.code;
}

/**
 * Step 5: JSX transformation using OXC
 * OXC is faster than Babel for JSX transformation.
 */
async function transformJsxWithOxc(
  code: string,
  filePath: string,
  options: { dev: boolean },
): Promise<string> {
  const oxc = await import('oxc-transform');

  // OXC determines JSX support based on file extension
  // For .js files with JSX, we need to use .jsx extension
  let jsxFilePath = filePath;
  if (filePath.endsWith('.js')) {
    jsxFilePath = filePath.replace(/\.js$/, '.jsx');
  }

  const result = oxc.transformSync(jsxFilePath, code, {
    jsx: {
      runtime: 'automatic',
      development: options.dev,
    },
  });

  if (result.errors && result.errors.length > 0) {
    // If OXC fails, return original code (JSX might already be transformed)
    return code;
  }

  return result.code || code;
}

/**
 * Full transformation pipeline following Metro's order:
 * 1-3. Babel + Hermes: Parse Flow + Strip Flow types
 * 4. SWC: ESM → CJS conversion
 * 5. OXC: JSX transformation (if needed)
 */
async function transformWithMetroOrder(
  code: string,
  filePath: string,
  options: { dev: boolean; platform: string },
): Promise<string> {
  let transformed = code;

  // Step 1-3: Strip Flow types with Babel + Hermes (if Flow syntax detected)
  if (hasFlowSyntax(code)) {
    transformed = await stripFlowTypesWithBabel(transformed, filePath);
  }

  // Step 4: ESM → CJS conversion with SWC
  const hasESM = /\bimport\s|^import\s|^export\s|\bexport\s/m.test(transformed);
  if (hasESM) {
    transformed = await convertEsmToCjsWithSwc(transformed, filePath, options);
  }

  // Step 5: JSX transformation with OXC (if JSX detected and not already transformed)
  // After SWC, JSX might already be transformed, so check if still present
  if (hasJSXSyntax(transformed)) {
    transformed = await transformJsxWithOxc(transformed, filePath, options);
  }

  return transformed;
}

/**
 * Check if code contains JSX syntax
 */
function hasJSXSyntax(code: string): boolean {
  // Check for JSX elements: <Component or <div
  return /<[A-Z][a-zA-Z0-9.]*[\s/>]|<[a-z]+[\s/>]/.test(code);
}

/**
 * Remove Flow type imports (import typeof, import type, etc.)
 * Exported for use in dependency extraction
 */
export function removeFlowTypeImports(code: string): string {
  let cleaned = code;

  const flowTypeImportPatterns = [
    /import\s+typeof\s+\*\s+as\s+\w+\s+from\s+['"][^'"]+['"];?\n?/g,
    /import\s+typeof\s+\w+\s+from\s+['"][^'"]+['"];?\n?/g,
    /import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\n?/g,
    /import\s+type\s+\w+\s+from\s+['"][^'"]+['"];?\n?/g,
  ];

  for (const pattern of flowTypeImportPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned;
}


/**
 * Inject define variables (__DEV__, __PLATFORM__, process.env.NODE_ENV)
 * Note: This is only used as fallback. Bun.build() handles define variables automatically.
 */
function injectDefineVariables(code: string, platform: string, dev: boolean): string {
  let transformed = code;

  // Replace __DEV__ with actual value
  transformed = transformed.replace(/\b__DEV__\b/g, String(dev));

  // Replace __PLATFORM__ with actual value
  transformed = transformed.replace(/\b__PLATFORM__\b/g, JSON.stringify(platform));

  // Replace process.env.NODE_ENV
  const nodeEnv = JSON.stringify(dev ? 'development' : 'production');
  transformed = transformed.replace(
    /\bprocess\.env\.NODE_ENV\b/g,
    nodeEnv,
  );

  return transformed;
}

/**
 * Remove type assertions and post-process code using Oxc or Babel
 *
 * For Flow files or files with JSX, use Babel + Hermes parser (like Metro)
 * For TypeScript files, use Oxc
 */
export async function removeTypeAssertionsWithOxc(
  code: string,
  options: TransformOptions,
): Promise<{ code: string; map?: string }> {
  const { filePath, platform, dev } = options;

  // Check if this is a Flow file or contains JSX
  // React Native .js files often contain both Flow and JSX
  const isFlow = hasFlowSyntax(code);
  const isJSX = hasJSXSyntax(code);

  // For Flow or JSX files, use Metro-ordered transformation pipeline:
  // 1-3. Babel + Hermes: Parse Flow + Strip Flow types
  // 4. SWC: ESM → CJS conversion
  // 5. OXC: JSX transformation
  if (isFlow || isJSX) {
    const transformed = await transformWithMetroOrder(code, filePath, { dev, platform });
    // Inject define variables (handled by each transformer, but ensure completeness)
    const processed = injectDefineVariables(transformed, platform, dev);
    return { code: processed };
  }

  // For non-Flow, non-JSX files (plain JS/TS), use Oxc
  const oxc = await import('oxc-transform');

  // Determine if file is TypeScript/TSX
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');

  // Check if code contains type assertions (even in .js files)
  const hasTypeAssertions = /as\s+[\w.]+|satisfies\s+[\w.]+/.test(code);

  // Oxc transform options - only for type assertion removal
  const transformOptions: any = {
    sourceType: 'module' as const,
  };

  // Add TypeScript options if file is TS/TSX OR if code has type assertions
  if (isTS || hasTypeAssertions) {
    transformOptions.typescript = {
      onlyRemoveTypeImports: false,
      allowNamespaces: true,
    };
  }

  try {
    // Try with options first, fallback to no options if it fails
    let result;

    try {
      result = oxc.transformSync(filePath, code, transformOptions);
    } catch (optionsError) {
      // If options fail, try without options (for plain JS files)
      try {
        result = oxc.transformSync(filePath, code);
      } catch (noOptionsError) {
        // If both fail, use Babel/Hermes as fallback
        const strippedCode = await stripFlowTypesWithBabel(code, filePath);
        const processed = injectDefineVariables(strippedCode, platform, dev);
        return { code: processed };
      }
    }

    // Check for errors in result
    if (result.errors && result.errors.length > 0) {
      const errorMessages = result.errors.map((e: any) => e.message || String(e)).join(', ');
      // If Oxc has errors, use Babel/Hermes as fallback (handles Flow + JSX)
      const strippedCode = await stripFlowTypesWithBabel(code, filePath);
      const processed = injectDefineVariables(strippedCode, platform, dev);
      return { code: processed };
    }

    // If no code but no errors, use original code
    let transformed = result.code || code;

    // Post-processing: Flow removal only
    // Note: ESM → CJS conversion is handled by Bun.build() (format: 'cjs')
    // Note: define variables are already handled by Bun.Transpiler
    transformed = removeFlowTypeImports(transformed);

    return {
      code: transformed,
      map: result.map?.toString(),
    };
  } catch (error) {
    // If Oxc transformation fails, fallback to post-processing only
    if (error instanceof Error && error.message.includes('Oxc transformation')) {
      throw error;
    }
    // For other errors, use post-processing only
    // Note: ESM → CJS conversion is handled by Bun.build()
    let processed = removeFlowTypeImports(code);
    processed = injectDefineVariables(processed, platform, dev);
    return { code: processed };
  }
}

/**
 * Transform code using Oxc for all transformations
 */
export async function transformWithOxc(
  options: TransformOptions,
): Promise<TransformResult> {
  const { code, filePath, platform, dev } = options;

  // Load Oxc (required dependency)
  const oxc = await import('oxc-transform');

  // Determine if file is TypeScript/TSX
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  const isJSX = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');

  // Oxc transform options
  // Note: oxc-transform doesn't support ESM → CJS conversion directly
  // We need to use Bun.build() or another tool for that
  // For now, we'll use Bun.Transpiler for ESM → CJS conversion
  const transformOptions: any = {
    sourceType: 'module' as const,
    // oxc-transform doesn't have ESM → CJS conversion option
    // We'll handle it separately if needed
  };

  // Add TypeScript options if needed
  if (isTS) {
    transformOptions.typescript = {
      onlyRemoveTypeImports: false,
      allowNamespaces: true,
    };
  }

  try {
    // Try with options first, fallback to no options if it fails
    let result;
    let lastError: unknown;
    
    try {
      result = oxc.transformSync(filePath, code, transformOptions);
    } catch (optionsError) {
      lastError = optionsError;
      // If options fail, try without options (for plain JS files)
      try {
        result = oxc.transformSync(filePath, code);
      } catch (noOptionsError) {
        lastError = noOptionsError;
        // If both fail, throw with detailed error
        const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(
          `Oxc transformation failed for ${filePath}: ${errorMessage}`,
        );
      }
    }

    // Check for errors in result first
    if (result.errors && result.errors.length > 0) {
      const errorMessages = result.errors.map((e: any) => e.message || String(e)).join(', ');
      // If error is about Flow or unsupported syntax, return original code with post-processing
      if (errorMessages.includes('Flow') || errorMessages.includes('not supported')) {
        // Apply post-processing to original code
        // Note: ESM → CJS conversion is handled by Bun.build()
        let processed = removeFlowTypeImports(code);
        processed = injectDefineVariables(processed, platform, dev);
        const dependencies = await extractDependencies(code);
        return {
          code: processed,
          dependencies,
        };
      }
      throw new Error(`Oxc transformation errors for ${filePath}: ${errorMessages}`);
    }

    // If no code but no errors, use original code
    let transformed = result.code || code;

    // Post-processing: Apply define variables, Flow removal
    // Note: ESM → CJS conversion is handled by Bun.build()
    transformed = removeFlowTypeImports(transformed);
    transformed = injectDefineVariables(transformed, platform, dev);

    // Extract dependencies from original code
    // Use AST-based extraction with oxc for accurate dependency detection
    const dependencies = await extractDependencies(code);

    return {
      code: transformed,
      map: result.map?.toString(),
      dependencies,
    };
  } catch (error) {
    // If Oxc transformation fails, throw with context
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(
      `Oxc transformation failed for ${filePath}: ${String(error)}`,
    );
  }
}


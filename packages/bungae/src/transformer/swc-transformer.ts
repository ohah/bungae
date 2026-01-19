/**
 * SWC Transformer - Main transformer using SWC for all code transformations
 */

import type { TransformOptions, TransformResult } from './types';
import { extractDependencies } from './utils';

/**
 * Check if code contains Flow syntax (Metro-compatible)
 * Metro uses @flow pragma comment as the primary indicator
 */
export async function hasFlowSyntax(code: string, filePath?: string): Promise<boolean> {
  // Metro's primary method: Check for @flow pragma comment
  if (/@flow/.test(code) || /@noflow/.test(code)) {
    return true;
  }

  // Secondary check: Try to parse with Hermes parser
  // If Hermes parser can parse it but SWC can't, it might be Flow
  try {
    const hermesParser = await import('hermes-parser');
    const swc = await import('@swc/core');

    // Try parsing with Hermes parser (can parse Flow)
    try {
      hermesParser.parse(code, {
        babel: true,
        sourceType: 'module',
      });

      // Hermes parser succeeded, now check if SWC can parse it
      try {
        await swc.parse(code, {
          syntax: 'ecmascript',
          target: 'es2015',
        });
        // SWC can parse it, so it's not Flow
        return false;
      } catch {
        // SWC can't parse, but Hermes can - likely Flow syntax
        return true;
      }
    } catch {
      // Hermes parser also failed, not Flow
      return false;
    }
  } catch {
    // If parsers are not available, fallback to @flow comment check only
    return false;
  }

  return false;
}

/**
 * Strip Flow types using Babel with Hermes parser (Metro-compatible)
 */
export async function stripFlowTypesWithBabel(code: string, filePath?: string): Promise<string> {
  const babel = await import('@babel/core');
  const hermesParser = await import('hermes-parser');
  const flowPlugin = await import('@babel/plugin-transform-flow-strip-types');

  const babelConfig = {
    ast: true,
    babelrc: false,
    configFile: false,
    filename: filePath || 'file.js',
    sourceType: 'module' as const,
    plugins: [[flowPlugin.default]],
  };

  // Parse with Hermes parser (like Metro does)
  const sourceAst = hermesParser.parse(code, {
    babel: true,
    sourceType: babelConfig.sourceType,
  });

  // Transform AST with Babel (Flow type stripping)
  const { transformFromAstSync } = await import('@babel/core');
  const transformResult = transformFromAstSync(sourceAst, code, babelConfig);

  if (!transformResult?.code) {
    throw new Error(`Babel Flow stripping failed for ${filePath}: transformation returned empty code`);
  }

  return transformResult.code;
}

/**
 * Transform code with SWC - handles ESM→CJS, JSX, TypeScript in one pass
 */
export async function transformWithSwcCore(
  code: string,
  filePath: string,
  options: { dev: boolean; module?: 'commonjs' | 'es6'; platform?: string },
): Promise<string> {
  const swc = await import('@swc/core');
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');

  // Check for JSX in code (for .js files that contain JSX)
  const hasJSXInCode = /<[A-Z][a-zA-Z0-9.]*[\s/>]|<[a-z]+[\s/>]|<\/[A-Z]|<\/[a-z]/.test(code);
  const isJSX = filePath.endsWith('.tsx') || filePath.endsWith('.jsx') || hasJSXInCode;

  const parserConfig: any = {
    syntax: isTS ? 'typescript' : 'ecmascript',
    decorators: false,
    dynamicImport: true,
  };

  if (isJSX) {
    if (isTS) {
      parserConfig.tsx = true;
    } else {
      parserConfig.jsx = true;
    }
  }

  // Build define variables for SWC optimizer
  const defineVars: Record<string, string> = {
    __DEV__: String(options.dev),
  };
  if (options.platform) {
    defineVars.__PLATFORM__ = JSON.stringify(options.platform);
  }

  const swcOptions: any = {
    filename: filePath,
    jsc: {
      parser: parserConfig,
      target: 'es2015',
      keepClassNames: true,
      transform: {
        ...(isJSX
          ? {
              react: {
                runtime: 'automatic',
                development: options.dev,
              },
            }
          : {}),
        optimizer: {
          globals: {
            vars: defineVars,
          },
        },
      },
    },
    sourceMaps: false,
    configFile: false,
    swcrc: false,
  };

  // Add module config for ESM→CJS conversion
  if (options.module === 'commonjs') {
    swcOptions.module = {
      type: 'commonjs',
      strict: false,
      strictMode: false,
      lazy: false,
      noInterop: false,
    };
    swcOptions.isModule = true;
  }

  const result = await swc.transform(code, swcOptions);

  // Empty code is valid (e.g., empty files or files with only comments)
  return result.code ?? '';
}

/**
 * Full transformation pipeline for Flow files:
 * 1-3. Babel + Hermes: Strip Flow types
 * 4-5. SWC: ESM → CJS conversion + JSX transformation + define variables
 */
export async function transformWithMetroOrder(
  code: string,
  filePath: string,
  options: { dev: boolean; platform: string },
): Promise<string> {
  // Step 1-3: Strip Flow types with Babel + Hermes
  let transformed = await stripFlowTypesWithBabel(code, filePath);

  // Step 4-5: ESM → CJS + JSX transformation with SWC (includes __DEV__, __PLATFORM__ via optimizer)
  transformed = await transformWithSwcCore(transformed, filePath, {
    dev: options.dev,
    module: 'commonjs',
    platform: options.platform,
  });

  return transformed;
}

/**
 * Inject define variables (__DEV__, __PLATFORM__)
 * Note: SWC optimizer handles these during transform, but this is kept as fallback
 */
export function injectDefineVariables(code: string, platform: string, dev: boolean): string {
  let transformed = code;

  // These are now primarily handled by SWC optimizer, but kept for edge cases
  transformed = transformed.replace(/\b__DEV__\b/g, String(dev));
  transformed = transformed.replace(/\b__PLATFORM__\b/g, JSON.stringify(platform));

  return transformed;
}

/**
 * Transform code using SWC
 * For Flow files, uses Babel + Hermes first, then SWC
 * For non-Flow files, uses SWC directly
 */
export async function removeTypeAssertionsWithSwc(
  code: string,
  options: TransformOptions,
): Promise<{ code: string; map?: string }> {
  const { filePath, platform, dev } = options;

  // Check if this is a Flow file
  const isFlow = await hasFlowSyntax(code, filePath);

  if (isFlow) {
    const transformed = await transformWithMetroOrder(code, filePath, { dev, platform });
    return { code: transformed };
  }

  // For non-Flow files, use SWC directly with ESM→CJS conversion
  const transformed = await transformWithSwcCore(code, filePath, {
    dev,
    module: 'commonjs',
    platform,
  });

  return { code: transformed };
}

/**
 * Transform code using SWC for all transformations
 */
export async function transformWithSwc(options: TransformOptions): Promise<TransformResult> {
  const { code, filePath, platform, dev } = options;

  const transformed = await transformWithSwcCore(code, filePath, { dev, platform });

  const dependencies = await extractDependencies(code);

  return {
    code: transformed,
    dependencies,
  };
}

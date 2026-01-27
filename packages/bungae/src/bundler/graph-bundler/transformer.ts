/**
 * Code transformation for Graph Bundler
 * Uses Babel with @react-native/babel-preset (Metro-compatible)
 */

import type { File as BabelAST } from '@babel/types';
import { extname } from 'path';

import type { ResolvedConfig } from '../../config/types';

/**
 * Transform a single file using Babel (Metro-compatible)
 * Uses Hermes parser for Flow, Babel for all transformations
 */
export async function transformFile(
  filePath: string,
  code: string,
  config: ResolvedConfig,
  entryPath?: string,
): Promise<{ ast: BabelAST } | null> {
  const { platform, dev } = config;

  // Skip Flow files and asset files
  if (filePath.endsWith('.flow.js') || filePath.endsWith('.flow')) {
    return null;
  }

  // JSON files: Export as module (no AST transformation needed)
  const isJSON = filePath.endsWith('.json');
  if (isJSON) {
    // Wrap JSON as CommonJS module - create simple AST
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync(`module.exports = ${code};`, {
      filename: filePath,
      sourceType: 'module',
    });
    if (!ast) return null;
    return { ast };
  }

  // Use Babel for all transformations (Metro-compatible)
  // Note: Asset files are handled in processModule before reaching here
  return transformWithBabel(code, filePath, {
    dev,
    platform,
    root: config.root,
    entryPath,
  });
}

/**
 * Transform code using Babel with @react-native/babel-preset (Metro-compatible)
 * Uses the same preset that Metro uses for full compatibility
 * Reads babel.config.js from project root and merges with default settings (Metro-compatible)
 */
export async function transformWithBabel(
  code: string,
  filePath: string,
  options: { dev: boolean; platform: string; root: string; entryPath?: string },
): Promise<{ ast: BabelAST }> {
  const babel = await import('@babel/core');
  const hermesParser = await import('hermes-parser');

  // Metro-compatible: Set BABEL_ENV for @react-native/babel-preset
  // This is required for codegen and other Babel preset features
  // Metro sets BABEL_ENV before transform (see metro-babel-transformer/src/index.js)
  const OLD_BABEL_ENV = process.env.BABEL_ENV;
  process.env.BABEL_ENV = options.dev ? 'development' : process.env.BABEL_ENV || 'production';

  try {
    // Metro-style babel config (matches reference/metro/packages/metro-babel-transformer/src/index.js)
    // Metro relies entirely on Babel's built-in config discovery (babelrc: true, cwd: projectRoot)
    // Babel automatically loads babel.config.js and resolves module: prefixed presets
    const babelConfig: any = {
      ast: true,
      babelrc: true, // Metro-compatible: enableBabelRCLookup defaults to true
      caller: {
        bundler: 'metro',
        name: 'metro',
        platform: options.platform,
      },
      cloneInputAst: false,
      code: false, // Metro-compatible: return AST only, serializer generates code
      cwd: options.root,
      filename: filePath,
      highlightCode: true,
      sourceType: 'module',
      plugins: [
        [
          require.resolve('babel-plugin-transform-define'),
          {
            'Platform.OS': options.platform,
            'process.env.NODE_ENV': JSON.stringify(options.dev ? 'development' : 'production'),
          },
        ],
        [
          require.resolve('@babel/plugin-transform-object-rest-spread'),
          {
            loose: true,
            useBuiltIns: true,
          },
        ],
      ],
    };

    // Metro: Parse with Hermes parser (hermesParser: true) or Babel parser (hermesParser: false)
    // Select parser based on file extension (Metro-compatible):
    // - TypeScript files (.ts, .tsx) → Babel parser (TypeScript support)
    // - JavaScript/Flow files (.js, .jsx, .flow) → Hermes parser (Flow support including "import typeof")
    const fileExt = extname(filePath).toLowerCase();
    const useHermesParser = !fileExt.endsWith('.ts') && !fileExt.endsWith('.tsx');

    const sourceAst = useHermesParser
      ? hermesParser.parse(code, {
          babel: true,
          sourceType: babelConfig.sourceType,
        })
      : await babel.parseAsync(code, {
          filename: filePath,
          sourceType: babelConfig.sourceType,
          parserOpts: {
            // TypeScript files: use typescript plugin only (not flow)
            // JavaScript files: use jsx plugin only (flow handled by Hermes parser)
            plugins:
              fileExt.endsWith('.tsx') || fileExt.endsWith('.ts') ? ['jsx', 'typescript'] : ['jsx'],
          },
        });

    const transformResult = await babel.transformFromAstAsync(sourceAst, code, babelConfig);

    if (!transformResult?.ast) {
      // Type-only files may result in empty AST - create empty module AST
      // Create File node (Metro-compatible) with Program inside
      const emptyProgram = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'module' },
                property: { type: 'Identifier', name: 'exports' },
              },
              right: { type: 'ObjectExpression', properties: [] },
            },
          },
        ],
        directives: [],
        sourceType: 'module',
      };
      const emptyAst = {
        type: 'File',
        program: emptyProgram,
        comments: [],
        tokens: [],
      };
      return { ast: emptyAst as BabelAST };
    }

    // Metro-compatible: return AST only (no code generation, no source map)
    // Dependencies will be extracted from AST directly
    // Source maps are NOT generated here (Metro-compatible)
    // Metro's metro-babel-transformer does NOT generate source maps
    // Source maps are generated later in transform worker using generate() from AST
    // In Bungae, source maps are generated in graphToSerializerModules() using generate()
    return { ast: transformResult.ast };
  } finally {
    if (OLD_BABEL_ENV) {
      process.env.BABEL_ENV = OLD_BABEL_ENV;
    }
  }
}

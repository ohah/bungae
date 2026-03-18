/**
 * Flow Strip Plugin for Rolldown
 *
 * Strips Flow type annotations from JavaScript files.
 * Uses hermes-parser (WASM) for fast parsing, then Babel's
 * transformFromAstAsync for type stripping only (no re-parsing).
 *
 * ~2.9x faster than full Babel pipeline (babel.transformAsync +
 * babel-plugin-syntax-hermes-parser + flow-strip-types).
 *
 * IMPORTANT: Must use `load` hook (not `transform`) because Rolldown/OXC
 * cannot parse Flow syntax. The file must be transformed BEFORE Rolldown
 * attempts to parse it.
 *
 * Only processes .js/.jsx files (TypeScript is handled natively by OXC).
 */

import { readFileSync } from 'fs';

import flowStripTypesPlugin from '@babel/plugin-transform-flow-strip-types';
import type { Plugin } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';

/**
 * Check if code contains Flow syntax
 */
export function containsFlowSyntax(code: string): boolean {
  // @flow pragma (most common) - matches both:
  // // @flow
  // /* @flow */
  // * @flow strict-local  (inside JSDoc block comment)
  if (/@flow\b/.test(code)) return true;
  // Flow-specific keywords
  if (/\bopaque\s+type\b/.test(code)) return true;
  if (/\bdeclare\s+(module|class|function|var|type|interface|export)\b/.test(code)) return true;
  return false;
}

/**
 * Check if hermes AST represents a CommonJS module.
 * Walks top-level statements looking for `module.exports = ...` or `exports.xxx = ...`.
 *
 * This is more reliable than regex because it ignores strings and comments,
 * and only checks actual assignment expressions at the top level.
 *
 * hermes-parser with `babel: true` returns a File node wrapping a Program node.
 */
export function isCommonJSFromAST(ast: { type: string; body?: any[]; program?: { body: any[] } }): boolean {
  const body = ast.type === 'File' ? ast.program?.body : ast.body;
  if (!body) return false;

  for (const node of body) {
    if (node.type === 'ExpressionStatement' && node.expression?.type === 'AssignmentExpression') {
      const left = node.expression.left;
      // module.exports = ...
      if (
        left?.type === 'MemberExpression' &&
        left.object?.type === 'Identifier' &&
        left.object.name === 'module' &&
        left.property?.type === 'Identifier' &&
        left.property.name === 'exports'
      ) {
        return true;
      }
      // exports.xxx = ...
      if (
        left?.type === 'MemberExpression' &&
        left.object?.type === 'Identifier' &&
        left.object.name === 'exports'
      ) {
        return true;
      }
    }
  }
  return false;
}

export function flowStripPlugin(_config: ResolvedConfig): Plugin {
  let hermes: typeof import('hermes-parser') | null = null;
  let babel: typeof import('@babel/core') | null = null;

  return {
    name: 'bungae:flow-strip',

    // Use `load` hook to transform Flow BEFORE Rolldown parses the file.
    async load(id: string) {
      // Only process JS/JSX files (not TS/TSX - OXC handles those)
      if (!/\.[cm]?jsx?$/.test(id)) return null;

      // Skip .flow.js definition files
      if (id.endsWith('.flow.js') || id.endsWith('.flow')) {
        return { code: 'export {};', moduleType: 'js' };
      }

      // Read file and check for Flow syntax
      let code: string;
      try {
        code = readFileSync(id, 'utf-8');
      } catch {
        return null;
      }

      if (!containsFlowSyntax(code)) return null;

      // Lazy load dependencies
      if (!hermes) {
        hermes = await import('hermes-parser');
      }
      if (!babel) {
        babel = await import('@babel/core');
      }

      // Parse as 'module' first — CJS syntax (module.exports = ...) is valid in module context.
      // Then detect CJS from the AST for accurate sourceType/moduleType decisions.
      const ast = hermes.parse(code, {
        babel: true,
        flow: 'all',
        sourceType: 'module',
        sourceFilename: id,
      });

      const cjs = isCommonJSFromAST(ast);
      const sourceType = cjs ? 'script' : 'module';

      // Use Babel only for transform (no re-parsing) - strips Flow types + generates code
      const result = await babel.transformFromAstAsync(ast, code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        sourceType,
        plugins: [flowStripTypesPlugin],
      });

      if (!result?.code) return null;

      return {
        code: result.code,
        map: result.map ? JSON.stringify(result.map) : undefined,
        // CJS files must use 'js' so Rolldown detects module.exports and wraps with __commonJSMin.
        // Using 'jsx' for CJS would make Rolldown treat it as ESM → unresolved exports → (void 0).
        moduleType: cjs ? 'js' : 'jsx',
      };
    },
  };
}

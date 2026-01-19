/**
 * Serializer Helpers - JS module processing
 */

import type { Module } from '../types';
import type { SerializerOptions } from '../types';
import { addParamsToDefineCall } from './addParamsToDefineCall';
import { convertRequirePaths } from './convertRequirePaths';

/**
 * Wrap module code with __d() call
 */
export async function wrapModule(module: Module, options: SerializerOptions): Promise<string> {
  // Script modules (type: 'js/script' or 'js/script/virtual') run as-is without __d() wrapping
  // This is Metro-compatible behavior - check module.type field
  if (isScriptModule(module)) {
    // Metro runtime polyfill is already wrapped in IIFE: (function (global) { ... })
    // We just need to call it with the global object
    if (module.type === 'js/script' && module.path.includes('metro-runtime/src/polyfills/')) {
      const globalThisFallback =
        "'undefined'!=typeof globalThis?globalThis:'undefined'!=typeof global?global:'undefined'!=typeof window?window:this";
      const trimmedCode = module.code.trim();
      if (trimmedCode.startsWith('(function') || trimmedCode.startsWith('!(function')) {
        const codeWithoutSemicolon = trimmedCode.replace(/;?\s*$/, '');
        return `${codeWithoutSemicolon}(${globalThisFallback});`;
      }
      return `!(function(global){${module.code}})(${globalThisFallback});`;
    }
    return module.code;
  }

  // For regular modules, wrap code in function and add __d() call
  // Metro format: __d(function(global, require, metroImportDefault, metroImportAll, module, exports, dependencyMap) { ... }, moduleId, dependencies)
  //
  // Step 0: Clean up code
  let cleanedCode = module.code;

  // Remove temporary file paths (.bungae-temp) that may be included by Bun.build() or bunup
  if (cleanedCode.includes('.bungae-temp')) {
    cleanedCode = cleanedCode.replace(
      /module\.exports\s*=\s*["'][^"']*\.bungae-temp[^"']*["'];?\s*/g,
      '',
    );
    cleanedCode = cleanedCode.replace(/^[^\n]*\.bungae-temp[^\n]*$/gm, '');
  }

  // Remove any remaining type assertions (Bun.build() or bunup might not remove all)
  // Match patterns like: } as Type; or ) as Type; (with optional whitespace/newlines)
  if (cleanedCode.includes(' as ')) {
    // First, match } followed by optional whitespace/newlines/comments, then "as Type;"
    // This handles cases like: }\n  // comment\n} as Type;
    cleanedCode = cleanedCode.replace(/\}\s*\n\s*\/\/[^\n]*\n\s*\}\s+as\s+[\w.]+;/gm, '};');
    // Match } followed by optional whitespace/newlines, then "as Type;"
    cleanedCode = cleanedCode.replace(/\}\s*\n?\s*as\s+[\w.]+;/gm, '};');
    // Match ) followed by optional whitespace/newlines, then "as Type;"
    cleanedCode = cleanedCode.replace(/\)\s*\n?\s*as\s+[\w.]+;/gm, ');');
    // Match inline: } as Type; (no newlines)
    cleanedCode = cleanedCode.replace(/\}\s+as\s+[\w.]+;/g, '};');
    // Match inline: ) as Type; (no newlines)
    cleanedCode = cleanedCode.replace(/\)\s+as\s+[\w.]+;/g, ');');
    // Final pass: match any remaining " as Type" patterns (most aggressive)
    cleanedCode = cleanedCode.replace(/\s+as\s+[\w.]+/g, '');
  }

  // SWC should have converted all imports to require() calls
  // If any remain, convert them manually as a fallback
  if (cleanedCode.includes('import ') || cleanedCode.includes('import{')) {
    // Convert remaining import statements to require() calls
    // Handle: import X, { Y, type Z } from "module"
    cleanedCode = cleanedCode.replace(
      /\bimport\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*/g,
      (match, defaultImport, namedImports, modulePath) => {
        // Remove type-only imports from namedImports
        const cleanedNamedImports = namedImports
          .split(',')
          .map((imp: string) => imp.trim())
          .filter((imp: string) => !imp.startsWith('type ') && !imp.startsWith('typeof '))
          .join(', ');
        if (cleanedNamedImports) {
          return `const ${defaultImport} = require("${modulePath}"); const {${cleanedNamedImports}} = require("${modulePath}");`;
        } else {
          return `const ${defaultImport} = require("${modulePath}");`;
        }
      },
    );
    // Handle: import X from "module"
    cleanedCode = cleanedCode.replace(
      /\bimport\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*/g,
      'const $1 = require("$2");',
    );
    // Handle: import { X, Y } from "module"
    cleanedCode = cleanedCode.replace(
      /\bimport\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*/g,
      'const {$1} = require("$2");',
    );
    // Handle: import * as X from "module"
    cleanedCode = cleanedCode.replace(
      /\bimport\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*/g,
      'const $1 = require("$2");',
    );
    // Handle: import * from "module"
    cleanedCode = cleanedCode.replace(
      /\bimport\s+\*\s+from\s+['"]([^'"]+)['"];?\s*/g,
      'require("$1");',
    );
    // Handle: import "module"
    cleanedCode = cleanedCode.replace(/\bimport\s+['"]([^'"]+)['"];?\s*/g, 'require("$1");');
    // Remove type-only imports (handle multiline imports)
    // Remove: import type { X } from "module"
    cleanedCode = cleanedCode.replace(
      /\bimport\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*/g,
      '',
    );
    cleanedCode = cleanedCode.replace(
      /\bimport\s+type\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*/g,
      '',
    );
    // Remove: import typeof { X } from "module" (multiline support)
    cleanedCode = cleanedCode.replace(
      /\bimport\s+typeof\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*/gs,
      '',
    );
    // Remove: import type X, { Y } from "module" (keep non-type imports)
    cleanedCode = cleanedCode.replace(
      /\bimport\s+type\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*/g,
      (match, typeImport, namedImports, modulePath) => {
        // Remove type-only imports from namedImports
        const cleanedNamedImports = namedImports
          .split(',')
          .map((imp: string) => imp.trim())
          .filter((imp: string) => !imp.startsWith('type ') && !imp.startsWith('typeof '))
          .join(', ');
        if (cleanedNamedImports) {
          return `const {${cleanedNamedImports}} = require("${modulePath}");`;
        } else {
          return '';
        }
      },
    );
    // Remove: import type X, { Y } from "module" (multiline support)
    cleanedCode = cleanedCode.replace(
      /\bimport\s+type\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*/gs,
      (match, typeImport, namedImports, modulePath) => {
        // Remove type-only imports from namedImports
        const cleanedNamedImports = namedImports
          .split(',')
          .map((imp: string) => imp.trim())
          .filter((imp: string) => !imp.startsWith('type ') && !imp.startsWith('typeof '))
          .join(', ');
        if (cleanedNamedImports) {
          return `const {${cleanedNamedImports}} = require("${modulePath}");`;
        } else {
          return '';
        }
      },
    );
  }

  // Step 1: Convert require paths to dependencyMap lookups
  // Metro converts require("./Bar") to require(dependencyMap[0])
  // Use original dependency paths (as they appear in source code) for conversion
  const dependencyPaths = module.originalDependencies || module.dependencies;
  let convertedCode = convertRequirePaths(
    cleanedCode,
    dependencyPaths,
    'require', // require parameter name
    'dependencyMap', // dependencyMap parameter name
  );

  // Step 2: Wrap in function and add __d() call
  const params = await getModuleParams(module, options);
  return addParamsToDefineCall(convertedCode, options.globalPrefix, ...params);
}

/**
 * Check if module is a script module (should not have __d() parameters)
 * Metro-compatible: checks module.type field ('js/script' or 'js/script/virtual')
 */
function isScriptModule(module: Module): boolean {
  // Primary check: module.type field (Metro-compatible)
  if (module.type?.startsWith('js/script')) {
    return true;
  }

  // Fallback for modules without type field (e.g., source-map, require- scripts)
  return module.path.startsWith('source-') || module.path.startsWith('require-');
}

/**
 * Get module parameters for __d() call
 */
export async function getModuleParams(
  module: Module,
  options: SerializerOptions,
): Promise<Array<unknown>> {
  const moduleId = options.createModuleId(module.path);

  // Convert dependencies to module IDs
  const dependencyIds = module.dependencies.map((dep) => options.createModuleId(dep));

  const params: Array<unknown> = [moduleId, dependencyIds];

  // Add verbose name in dev mode
  if (options.dev) {
    const pathModule = await import('path');
    const relativePath = pathModule.relative(options.projectRoot, module.path);
    params.push(relativePath.replace(/\\/g, '/'));
  }

  return params;
}

/**
 * Check if module is a JS module
 */
export function isJsModule(module: Module): boolean {
  return (
    module.path.endsWith('.js') ||
    module.path.endsWith('.jsx') ||
    module.path.endsWith('.ts') ||
    module.path.endsWith('.tsx')
  );
}

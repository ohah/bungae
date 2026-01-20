/**
 * Serializer Helpers - JS module processing
 */

import type { Module } from '../types';
import type { SerializerOptions } from '../types';
import { addParamsToDefineCall } from './addParamsToDefineCall';
import { convertRequirePaths } from './convertRequirePaths';

/**
 * Transform script code (Flow -> JS) using Babel
 * Script modules like polyfills need to be transformed but not wrapped in __d()
 * Metro transforms polyfills with the same babel preset as regular modules
 */
async function transformScriptCode(code: string, filePath: string): Promise<string> {
  try {
    const babel = await import('@babel/core');
    const hermesParser = await import('hermes-parser');

    // Parse with Hermes parser (handles Flow syntax like Metro)
    let ast;
    try {
      ast = hermesParser.parse(code, {
        babel: true,
        sourceType: 'script',
      });
    } catch {
      // If Hermes parser fails, try Babel parser
      try {
        const result = await babel.parseAsync(code, {
          filename: filePath,
          sourceType: 'script',
          parserOpts: {
            plugins: ['flow'],
          },
        });
        ast = result;
      } catch {
        // If parsing fails, return code as-is
        return code;
      }
    }

    // Use @react-native/babel-preset like Metro does for polyfills
    // enableBabelRuntime: false to inline helpers
    const result = await babel.transformFromAstAsync(ast, code, {
      filename: filePath,
      babelrc: false,
      configFile: false,
      sourceType: 'script',
      presets: [
        [
          require.resolve('@react-native/babel-preset'),
          {
            dev: true,
            unstable_transformProfile: 'hermes-stable',
            enableBabelRuntime: false,
            disableImportExportTransform: true, // Script modules don't need ESM->CJS
            disableStaticViewConfigsCodegen: true,
          },
        ],
      ],
      compact: false,
      comments: true,
    });

    return result?.code || code;
  } catch (error) {
    // If transformation fails, return code as-is
    console.warn(`[bungae] Failed to transform script ${filePath}:`, error);
    return code;
  }
}

/**
 * Wrap module code with __d() call
 */
export async function wrapModule(module: Module, options: SerializerOptions): Promise<string> {
  // Script modules (type: 'js/script' or 'js/script/virtual') run as-is without __d() wrapping
  // This is Metro-compatible behavior - check module.type field
  if (isScriptModule(module)) {
    // Virtual script (prelude) doesn't need transformation
    if (module.type === 'js/script/virtual') {
      return module.code;
    }

    // Script modules (polyfills, metro-runtime) need Flow transformation like Metro does
    // Metro transforms all modules including polyfills through its transform pipeline
    const transformedCode = await transformScriptCode(module.code, module.path);

    // All script modules need to be wrapped in IIFE with global parameter
    // Metro wraps all polyfills: (function (global) { ... })(globalThis || global || window || this)
    const globalThisFallback =
      "'undefined'!=typeof globalThis?globalThis:'undefined'!=typeof global?global:'undefined'!=typeof window?window:this";

    // Metro runtime polyfill is already wrapped in IIFE: (function (global) { ... })
    // We just need to call it with the global object
    if (module.path.includes('metro-runtime/src/polyfills/')) {
      const trimmedCode = transformedCode.trim();
      if (trimmedCode.startsWith('(function') || trimmedCode.startsWith('!(function')) {
        const codeWithoutSemicolon = trimmedCode.replace(/;?\s*$/, '');
        return `${codeWithoutSemicolon}(${globalThisFallback});`;
      }
    }

    // Wrap other polyfills (console.js, error-guard.js) in IIFE
    return `(function (global) {\n${transformedCode}\n})(${globalThisFallback});`;
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
  // Pass all module paths to getModuleParams for validation
  const allModulePaths = (options as { allModulePaths?: Set<string> }).allModulePaths;
  const params = await getModuleParams(module, options, allModulePaths);
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
  allModulePaths?: Set<string>,
): Promise<Array<unknown>> {
  const moduleId = options.createModuleId(module.path);

  // Convert dependencies to module IDs
  // Warn if a dependency path is not in the bundle (dev mode only)
  const dependencyIds = module.dependencies.map((dep) => {
    const depId = options.createModuleId(dep);

    // In dev mode, check if the dependency path exists in the bundle
    if (options.dev && allModulePaths && !allModulePaths.has(dep)) {
      // This is a warning, not an error, as the module might be resolved differently
      // (e.g., platform-specific files)
      console.warn(
        `[bungae] Warning: Dependency "${dep}" of module "${module.path}" ` +
          `is not in the bundle. This may cause "unknown module" errors. ` +
          `Module ID assigned: ${depId}`,
      );
    }

    return depId;
  });

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
 * Check if module is a JS module (or JSON/asset, which should be wrapped as JS)
 * Asset modules are also JS modules because they contain code that registers the asset
 */
export function isJsModule(module: Module): boolean {
  // Standard JS/TS/JSON modules
  if (
    module.path.endsWith('.js') ||
    module.path.endsWith('.jsx') ||
    module.path.endsWith('.ts') ||
    module.path.endsWith('.tsx') ||
    module.path.endsWith('.json')
  ) {
    return true;
  }

  // Asset modules (images, fonts, etc.) - these are converted to JS modules
  // that call AssetRegistry.registerAsset()
  // Check if the code contains registerAsset (asset module marker)
  if (module.code.includes('registerAsset')) {
    return true;
  }

  // Also check for common asset extensions
  const assetExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'];
  if (assetExts.some((ext) => module.path.endsWith(ext))) {
    return true;
  }

  return false;
}

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
 * Reads babel.config.js from project root and merges with default settings (Metro-compatible)
 */
async function transformScriptCode(
  code: string,
  filePath: string,
  projectRoot: string,
): Promise<string> {
  try {
    const babel = await import('@babel/core');
    const hermesParser = await import('hermes-parser');

    // Metro uses transformFromAstSync: parse AST first, then transform
    // Metro behavior: hermesParser option determines parser (Hermes or Babel)
    // We use Hermes parser by default (like Metro with hermesParser: true)
    let sourceAst;
    try {
      sourceAst = hermesParser.parse(code, {
        babel: true,
        sourceType: 'script',
      });
    } catch {
      // If Hermes parser fails, try Babel parser
      try {
        sourceAst = await babel.parseAsync(code, {
          filename: filePath,
          sourceType: 'script',
          parserOpts: {
            plugins: ['flow'],
          },
        });
      } catch {
        // If parsing fails, return code as-is
        return code;
      }
    }

    // Metro-style babel config (matches reference/metro/packages/metro-babel-transformer/src/index.js)
    // Metro doesn't set presets/plugins here - Babel reads babel.config.js automatically from cwd
    const babelConfig: any = {
      ast: true,
      babelrc: false, // Metro uses enableBabelRCLookup, we use false for consistency
      caller: { bundler: 'bungae', name: 'bungae', platform: null },
      cloneInputAst: false, // Metro sets this to avoid cloning overhead
      code: true, // We need code output
      cwd: projectRoot, // Metro sets cwd to projectRoot - Babel auto-discovers babel.config.js from here
      filename: filePath,
      highlightCode: true,
      sourceType: 'script',
      // Metro doesn't set presets/plugins here - Babel reads babel.config.js automatically
      // No additional plugins for script modules
    };

    // Metro: Transform AST with Babel (Babel reads babel.config.js automatically from cwd)
    const result = await babel.transformFromAstAsync(sourceAst, code, babelConfig);

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
    const transformedCode = await transformScriptCode(
      module.code,
      module.path,
      options.projectRoot,
    );

    // All script modules need to be wrapped in IIFE with global parameter
    // Metro wraps all polyfills: (function (global) { ... })(globalThis || global || window || this)
    // This is critical for HMR to work - without IIFE, 'global' is undefined
    const globalThisFallback =
      "'undefined'!=typeof globalThis?globalThis:'undefined'!=typeof global?global:'undefined'!=typeof window?window:this";

    // Check if already wrapped in IIFE
    const trimmedCode = transformedCode.trim();
    const isAlreadyIIFE =
      trimmedCode.startsWith('(function') || trimmedCode.startsWith('!(function');

    if (isAlreadyIIFE) {
      // Already IIFE, just call it with global object
      const codeWithoutSemicolon = trimmedCode.replace(/;?\s*$/, '');
      return `${codeWithoutSemicolon}(${globalThisFallback});`;
    }

    // Wrap all polyfills (metro-runtime/require.js, console.js, error-guard.js) in IIFE
    // Metro uses JsFileWrapping.wrapPolyfill() which wraps code in:
    // (function(global) { ... })(globalThis || global || window || this)
    return `(function (global) {\n${transformedCode}\n})(${globalThisFallback});`;
  }

  // For regular modules, wrap code in function and add __d() call
  // Metro format: __d(function(global, require, metroImportDefault, metroImportAll, module, exports, dependencyMap) { ... }, moduleId, dependencies)
  //
  // Note: Babel with @react-native/babel-preset already handles:
  // - ESM → CJS conversion (@babel/plugin-transform-modules-commonjs)
  // - TypeScript type stripping (@babel/plugin-transform-typescript)
  // - Flow type stripping (@babel/plugin-transform-flow-strip-types)
  // So we don't need to manually convert imports or strip types here.

  // Convert require paths to dependencyMap lookups
  // Metro converts require("./Bar") to require(dependencyMap[0])
  // Use original dependency paths (as they appear in source code) for conversion
  const dependencyPaths = module.originalDependencies || module.dependencies;
  const convertedCode = convertRequirePaths(
    module.code,
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

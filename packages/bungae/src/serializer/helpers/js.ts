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
  // Script modules (polyfills, prelude, metro-runtime) should not be wrapped with parameters
  // Metro treats js/script type modules as scripts that run as-is
  // Note: Modern Node.js (v12+) supports const/let in vm.runInNewContext, so no transformation needed
  // Metro's metro-runtime also uses const/let, and it works fine
  if (isScriptModule(module)) {
    return module.code;
  }

  // For regular modules, wrap code in function and add __d() call
  // Metro format: __d(function(global, require, metroImportDefault, metroImportAll, module, exports, dependencyMap) { ... }, moduleId, dependencies)
  //
  // Step 1: Convert require paths to dependencyMap lookups
  // Metro converts require("./Bar") to require(dependencyMap[0])
  // Use original dependency paths (as they appear in source code) for conversion
  const dependencyPaths = module.originalDependencies || module.dependencies;
  let convertedCode = convertRequirePaths(
    module.code,
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
 */
function isScriptModule(module: Module): boolean {
  // Script modules include:
  // - Prelude (variable declarations)
  // - Metro runtime
  // - Polyfills
  // - Source map comments
  return (
    module.path === '__prelude__' ||
    module.path.includes('metro-runtime') ||
    module.path === '/polyfill' ||
    module.path.startsWith('source-') ||
    module.path.startsWith('require-')
  );
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

/**
 * Serializer Helpers - JS module processing
 */

import type { Module } from '../types';
import type { SerializerOptions } from '../types';
import { addParamsToDefineCall } from './addParamsToDefineCall';

/**
 * Wrap module code with __d() call
 */
export async function wrapModule(module: Module, options: SerializerOptions): Promise<string> {
  // Script modules (polyfills, prelude, metro-runtime) should not be wrapped with parameters
  // Metro treats js/script type modules as scripts that run as-is
  if (isScriptModule(module)) {
    return module.code;
  }

  const params = await getModuleParams(module, options);
  return addParamsToDefineCall(module.code, ...params);
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

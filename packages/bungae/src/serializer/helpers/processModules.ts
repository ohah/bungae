/**
 * Process modules - Convert modules to __d() format
 */

import type { Module } from '../types';
import type { SerializerOptions } from '../types';
import { isJsModule, wrapModule } from './js';

/**
 * Processed module result with optional source map
 * [Module, code, sourceMap]
 */
export type ProcessedModule = [Module, string, any | null];

/**
 * Process modules and convert to __d() format
 * Returns [Module, code, sourceMap] tuples
 */
export async function processModules(
  modules: ReadonlyArray<Module>,
  options: SerializerOptions,
): Promise<ReadonlyArray<ProcessedModule>> {
  const filter = options.processModuleFilter || (() => true);

  // Collect all module paths for dependency validation
  const allModulePaths = new Set(modules.map((m) => m.path));
  const optionsWithPaths = {
    ...options,
    allModulePaths,
  } as SerializerOptions & { allModulePaths: Set<string> };

  // For script modules (source-map, source-url, etc.), return code as-is
  // For JS modules, wrap with __d()
  const results = await Promise.all(
    modules.map(async (module: Module) => {
      // Check if it's a script module (source-map, source-url comments)
      // These have special paths that indicate they're scripts, not modules
      if (module.path.startsWith('source-') || module.path.startsWith('require-')) {
        return [module, module.code, null] as ProcessedModule;
      }

      if (!filter(module)) {
        return null;
      }

      // All other modules should be wrapped with __d()
      // If it's not a JS module by extension, we still wrap it
      // (Metro handles modules without extensions as JS modules)
      if (isJsModule(module) || !module.path.includes('.')) {
        const result = await wrapModule(module, optionsWithPaths);
        return [module, result.code, result.map] as ProcessedModule;
      }

      // For truly non-JS modules (like JSON), return as-is
      return [module, module.code, null] as ProcessedModule;
    }),
  );

  return results.filter((r): r is ProcessedModule => r !== null);
}

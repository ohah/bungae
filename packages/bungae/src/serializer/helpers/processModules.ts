/**
 * Process modules - Convert modules to __d() format
 */

import type { Module } from '../types';
import type { SerializerOptions } from '../types';
import { isJsModule, wrapModule } from './js';

/**
 * Process modules and convert to __d() format
 */
export async function processModules(
  modules: ReadonlyArray<Module>,
  options: SerializerOptions,
): Promise<ReadonlyArray<[Module, string]>> {
  const filter = options.processModuleFilter || (() => true);

  // For script modules (source-map, source-url, etc.), return code as-is
  // For JS modules, wrap with __d()
  const results = await Promise.all(
    modules.map(async (module: Module) => {
      // Check if it's a script module (source-map, source-url comments)
      // These have special paths that indicate they're scripts, not modules
      if (module.path.startsWith('source-') || module.path.startsWith('require-')) {
        return [module, module.code] as [Module, string];
      }

      if (!filter(module)) {
        return null;
      }

      // All other modules should be wrapped with __d()
      // If it's not a JS module by extension, we still wrap it
      // (Metro handles modules without extensions as JS modules)
      if (isJsModule(module) || !module.path.includes('.')) {
        return [module, await wrapModule(module, options)] as [Module, string];
      }

      // For truly non-JS modules (like JSON), return as-is
      return [module, module.code] as [Module, string];
    }),
  );

  return results.filter((r): r is [Module, string] => r !== null);
}

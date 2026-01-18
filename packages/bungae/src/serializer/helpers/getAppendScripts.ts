/**
 * Get append scripts - Entry execution and source map
 */

import type { Module } from '../types';
import type { SerializerOptions } from '../types';

/**
 * Get scripts to append after modules (entry execution, source map)
 */
export function getAppendScripts(
  entryPoint: string,
  modules: ReadonlyArray<Module>,
  options: SerializerOptions,
): ReadonlyArray<Module> {
  const output: Module[] = [];

  // Entry execution
  if (options.runModule) {
    const paths = [...(options.runBeforeMainModule || []), entryPoint];

    for (const modulePath of paths) {
      if (modules.some((m) => m.path === modulePath)) {
        const moduleId = options.createModuleId(modulePath);
        const code = options.getRunModuleStatement(moduleId, options.globalPrefix);

        output.push({
          path: `require-${modulePath}`,
          code,
          dependencies: [],
        });
      }
    }
  }

  // Source map URL
  if (options.sourceMapUrl) {
    const code = `//# sourceMappingURL=${options.sourceMapUrl}`;
    output.push({
      path: 'source-map',
      code,
      dependencies: [],
    });
  }

  // Source URL
  if (options.sourceUrl) {
    output.push({
      path: 'source-url',
      code: `//# sourceURL=${options.sourceUrl}`,
      dependencies: [],
    });
  }

  return output;
}

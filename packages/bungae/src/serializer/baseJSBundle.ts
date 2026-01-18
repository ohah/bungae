/**
 * Base JS Bundle - Metro-compatible bundle serializer
 */

import { readFileSync } from 'fs';

import { getPreludeCode } from './getPreludeCode';
import { getAppendScripts } from './helpers/getAppendScripts';
import { processModules } from './helpers/processModules';
import type { Module, Bundle, SerializerOptions } from './types';

/**
 * Create base JS bundle in Metro-compatible format
 */
export async function baseJSBundle(
  entryPoint: string,
  preModules: ReadonlyArray<Module>,
  graphModules: ReadonlyArray<Module>,
  options: SerializerOptions,
): Promise<Bundle> {
  // Assign module IDs to all modules
  for (const module of graphModules) {
    options.createModuleId(module.path);
  }

  // Process preModules (prelude, metro-runtime, polyfills)
  const processOptions = {
    createModuleId: options.createModuleId,
    dev: options.dev,
    projectRoot: options.projectRoot,
    serverRoot: options.serverRoot,
    processModuleFilter: options.processModuleFilter,
    getRunModuleStatement: options.getRunModuleStatement,
    globalPrefix: options.globalPrefix,
    runModule: options.runModule,
  };

  const preProcessed = await processModules(preModules, processOptions);
  const preCode = preProcessed.map(([_, code]) => code).join('\n');

  // Sort modules by module ID
  const sortedModules = [...graphModules].sort((a, b) => {
    const idA = options.createModuleId(a.path);
    const idB = options.createModuleId(b.path);
    if (typeof idA === 'number' && typeof idB === 'number') {
      return idA - idB;
    }
    return String(idA).localeCompare(String(idB));
  });

  // Get append scripts (entry execution, source map)
  const appendModules = getAppendScripts(entryPoint, [...preModules, ...sortedModules], options);

  const postProcessed = await processModules(appendModules, processOptions);
  const postCode = postProcessed.map(([_, code]) => code).join('\n');

  // Create modules array: [moduleId, code][]
  const modulesProcessed = await processModules(sortedModules, processOptions);
  const modulesArray: Array<[number | string, string]> = modulesProcessed.map(([module, code]) => [
    options.createModuleId(module.path),
    code,
  ]);

  return {
    pre: preCode,
    post: postCode,
    modules: modulesArray,
  };
}

/**
 * Get prepended modules (prelude, metro-runtime, polyfills)
 */
export function getPrependedModules(options: {
  dev: boolean;
  globalPrefix: string;
  requireCycleIgnorePatterns?: RegExp[];
  polyfills?: string[];
}): Module[] {
  const modules: Module[] = [];

  // 1. Prelude (variable declarations)
  const preludeCode = getPreludeCode({
    isDev: options.dev,
    globalPrefix: options.globalPrefix,
    requireCycleIgnorePatterns: options.requireCycleIgnorePatterns || [],
  });

  modules.push({
    path: '__prelude__',
    code: preludeCode,
    dependencies: [],
  });

  // 2. Metro runtime
  try {
    const metroRuntimePath = require.resolve('metro-runtime/src/polyfills/require.js');
    const metroRuntimeCode = readFileSync(metroRuntimePath, 'utf-8');

    modules.push({
      path: metroRuntimePath,
      code: metroRuntimeCode,
      dependencies: [],
    });
  } catch (error) {
    throw new Error(
      `Failed to load metro-runtime: ${error}. Make sure metro-runtime is installed.`,
    );
  }

  // 3. Polyfills (if any)
  if (options.polyfills) {
    for (const polyfill of options.polyfills) {
      try {
        const polyfillPath = require.resolve(polyfill);
        const polyfillCode = readFileSync(polyfillPath, 'utf-8');

        modules.push({
          path: polyfillPath,
          code: polyfillCode,
          dependencies: [],
        });
      } catch (error) {
        console.warn(`Failed to load polyfill ${polyfill}: ${error}`);
      }
    }
  }

  return modules;
}

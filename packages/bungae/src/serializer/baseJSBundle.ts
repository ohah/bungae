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

  // Do not prepend polyfills or the require runtime when only modules are requested
  // Metro-compatible: modulesOnly option
  if (options.modulesOnly) {
    preModules = [];
  }

  // Process preModules (prelude, metro-runtime, polyfills)
  // Pass all serializer options to processModules
  const processOptions: SerializerOptions = {
    ...options,
    includeAsyncPaths: options.includeAsyncPaths ?? false,
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

  // Find InitializeCore module (React Native requires this to run before main module)
  // Metro runs InitializeCore before the entry point
  // InitializeCore is required for React Native to work properly
  // Note: InitializeCore should already be in the dependency graph (via react-native imports)
  // We only find it and add to runBeforeMainModule, we don't add it manually to avoid dependency issues
  let runBeforeMainModule = options.runBeforeMainModule || [];
  
  // Try to find InitializeCore module in graph modules
  // InitializeCore should be included in the dependency graph when react-native is imported
  const initializeCoreModule = sortedModules.find(
    (m) =>
      m.path.includes('Core/InitializeCore') ||
      m.path.endsWith('InitializeCore.js') ||
      m.path.includes('Libraries/Core/InitializeCore'),
  );
  
  if (initializeCoreModule && !runBeforeMainModule.includes(initializeCoreModule.path)) {
    runBeforeMainModule = [initializeCoreModule.path, ...runBeforeMainModule];
  }

  // Get append scripts (entry execution, source map)
  const appendModules = getAppendScripts(entryPoint, [...preModules, ...sortedModules], {
    ...options,
    runBeforeMainModule,
  });

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

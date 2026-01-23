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

  // Use runBeforeMainModule from options (set via getModulesRunBeforeMainModule config)
  // Metro uses getModulesRunBeforeMainModule function to get the list of modules to run before main
  // Metro does not have fallback logic - it only uses what's returned from getModulesRunBeforeMainModule
  const runBeforeMainModule = options.runBeforeMainModule || [];

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
 * These are all script modules (type: 'js/script') that run without __d() wrapping
 */
export function getPrependedModules(options: {
  dev: boolean;
  globalPrefix: string;
  requireCycleIgnorePatterns?: RegExp[];
  polyfills?: string[];
  extraVars?: Record<string, unknown>;
  projectRoot?: string;
}): Module[] {
  const modules: Module[] = [];

  // 1. Prelude (variable declarations) - virtual script
  const preludeCode = getPreludeCode({
    isDev: options.dev,
    globalPrefix: options.globalPrefix,
    requireCycleIgnorePatterns: options.requireCycleIgnorePatterns || [],
    extraVars: options.extraVars,
  });

  modules.push({
    path: '__prelude__',
    code: preludeCode,
    dependencies: [],
    type: 'js/script/virtual',
  });

  // 2. Metro runtime - script module (MUST come before polyfills)
  // Metro runtime defines __r, __d which are needed by the module system
  // Resolve from react-native package location (handles Bun's hoisted node_modules)
  try {
    const projectRoot = options.projectRoot || process.cwd();
    const { createRequire } = require('module');
    const projectRequire = createRequire(projectRoot + '/package.json');

    // First find react-native, then resolve metro-runtime from there
    const reactNativePath = projectRequire.resolve('react-native/package.json');
    const rnRequire = createRequire(reactNativePath);

    const metroRuntimePath = rnRequire.resolve('metro-runtime/src/polyfills/require.js');
    const metroRuntimeCode = readFileSync(metroRuntimePath, 'utf-8');

    modules.push({
      path: metroRuntimePath,
      code: metroRuntimeCode,
      dependencies: [],
      type: 'js/script',
    });
  } catch (error) {
    // Not a React Native project or metro-runtime not found, skip
    // This allows tests to run without react-native installed
    console.warn(`metro-runtime not found, skipping: ${error}`);
  }

  // 3. React Native polyfills (console, error-guard) - after metro-runtime
  // These define global.ErrorUtils and console polyfills
  // Resolve from react-native package location (handles Bun's hoisted node_modules)
  try {
    const projectRoot = options.projectRoot || process.cwd();
    const { createRequire } = require('module');
    const projectRequire = createRequire(projectRoot + '/package.json');

    // First find react-native, then resolve js-polyfills from there
    const reactNativePath = projectRequire.resolve('react-native/package.json');
    const rnRequire = createRequire(reactNativePath);

    const jsPolyfillsPath = rnRequire.resolve('@react-native/js-polyfills');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jsPolyfills = require(jsPolyfillsPath)();
    for (const polyfillPath of jsPolyfills) {
      const polyfillCode = readFileSync(polyfillPath, 'utf-8');
      modules.push({
        path: polyfillPath,
        code: polyfillCode,
        dependencies: [],
        type: 'js/script',
      });
    }
  } catch (error) {
    // Not a React Native project, skip
    console.warn(`@react-native/js-polyfills not found, skipping: ${error}`);
  }

  // 4. Additional polyfills (if any) - script modules
  if (options.polyfills) {
    for (const polyfill of options.polyfills) {
      try {
        const polyfillPath = require.resolve(polyfill);
        const polyfillCode = readFileSync(polyfillPath, 'utf-8');

        modules.push({
          path: polyfillPath,
          code: polyfillCode,
          dependencies: [],
          type: 'js/script',
        });
      } catch (error) {
        console.warn(`Failed to load polyfill ${polyfill}: ${error}`);
      }
    }
  }

  return modules;
}

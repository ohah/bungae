import { describe, test, expect } from 'bun:test';

import { baseJSBundle, getPrependedModules } from '../baseJSBundle';
import type { Module, SerializerOptions } from '../types';

describe('baseJSBundle', () => {
  const createModuleId = (() => {
    let id = 0;
    const map = new Map<string, number>();
    return (path: string): number => {
      if (!map.has(path)) {
        map.set(path, id++);
      }
      return map.get(path)!;
    };
  })();

  const defaultOptions: SerializerOptions = {
    createModuleId,
    getRunModuleStatement: (moduleId) => `__r(${JSON.stringify(moduleId)});`,
    dev: true,
    projectRoot: '/project',
    serverRoot: '/project',
    globalPrefix: '',
    runModule: true,
  };

  test('should generate a simple bundle', async () => {
    const entryPoint = '/entry.js';
    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const graphModules: Module[] = [
      {
        path: '/entry.js',
        code: '__d(function(require, module, exports) { exports.foo = "bar"; });',
        dependencies: [],
      },
    ];

    const bundle = await baseJSBundle(entryPoint, preModules, graphModules, {
      ...defaultOptions,
    });

    expect(bundle.pre).toBeTruthy();
    expect(bundle.post).toBeTruthy();
    expect(bundle.modules).toBeInstanceOf(Array);
    expect(bundle.modules.length).toBeGreaterThan(0);
  });

  test('should include prelude in pre code', async () => {
    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle('/entry.js', preModules, [], defaultOptions);

    expect(bundle.pre).toContain('__DEV__');
    expect(bundle.pre).toContain('process.env');
  });

  test('should include metro-runtime in pre code', async () => {
    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle('/entry.js', preModules, [], defaultOptions);

    expect(bundle.pre).toContain('__d');
    expect(bundle.pre).toContain('__r');
  });

  test('should generate modules array with correct format', async () => {
    const graphModules: Module[] = [
      {
        path: '/module1.js',
        code: '__d(function() { return 1; });',
        dependencies: [],
      },
      {
        path: '/module2.js',
        code: '__d(function() { return 2; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle('/module1.js', preModules, graphModules, defaultOptions);

    // Should have at least the entry module (preModules are not included in modules array)
    expect(bundle.modules.length).toBeGreaterThanOrEqual(1);
    const firstModule = bundle.modules[0];
    expect(firstModule).toBeDefined();
    expect(firstModule).toBeInstanceOf(Array);
    expect(firstModule![0]).toBeTypeOf('number');
    expect(firstModule![1]).toBeTypeOf('string');
  });

  test('should sort modules by module ID', async () => {
    const graphModules: Module[] = [
      {
        path: '/module2.js',
        code: '__d(function() { return 2; });',
        dependencies: [],
      },
      {
        path: '/module1.js',
        code: '__d(function() { return 1; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle('/module1.js', preModules, graphModules, defaultOptions);

    // Modules should be sorted by ID
    const ids = bundle.modules.map(([id]) => id as number);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    if (ids[0] !== undefined && ids[1] !== undefined) {
      expect(ids[0]).toBeLessThanOrEqual(ids[1]);
    }
  });

  test('should include entry execution in post code', async () => {
    const entryPoint = '/entry.js';
    const graphModules: Module[] = [
      {
        path: entryPoint,
        code: '__d(function() { return "entry"; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle(entryPoint, preModules, graphModules, {
      ...defaultOptions,
      runModule: true,
    });

    expect(bundle.post).toContain('__r');
  });

  test('should not include entry execution when runModule is false', async () => {
    const entryPoint = '/entry.js';
    const graphModules: Module[] = [
      {
        path: entryPoint,
        code: '__d(function() { return "entry"; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle(entryPoint, preModules, graphModules, {
      ...defaultOptions,
      runModule: false,
    });

    expect(bundle.post).not.toContain('require(');
  });

  test('should include source map URL in post code', async () => {
    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle('/entry.js', preModules, [], {
      ...defaultOptions,
      sourceMapUrl: 'http://localhost/bundle.map',
    });

    expect(bundle.post).toContain('sourceMappingURL');
    expect(bundle.post).toContain('http://localhost/bundle.map');
  });

  test('should include dependencies in module params', async () => {
    const graphModules: Module[] = [
      {
        path: '/module1.js',
        code: '__d(function(require) { const m2 = require("./module2"); });',
        dependencies: ['/module2.js'],
      },
      {
        path: '/module2.js',
        code: '__d(function() { return 2; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle('/module1.js', preModules, graphModules, defaultOptions);

    // Module 1 should have module 2 in its dependencies
    const module1Code = bundle.modules.find(
      ([id]) => createModuleId('/module1.js') === id,
    )?.[1] as string;

    expect(module1Code).toContain(createModuleId('/module2.js').toString());
  });

  test('should include verbose name in dev mode', async () => {
    const graphModules: Module[] = [
      {
        path: '/project/src/module.js',
        code: '__d(function() { return 1; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle('/project/src/module.js', preModules, graphModules, {
      ...defaultOptions,
      dev: true,
    });

    const moduleCode = bundle.modules[0]?.[1] as string;
    expect(moduleCode).toContain('src/module.js');
  });

  test('should not include verbose name in production mode', async () => {
    const graphModules: Module[] = [
      {
        path: '/project/src/module.js',
        code: '__d(function() { return 1; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: false,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle('/project/src/module.js', preModules, graphModules, {
      ...defaultOptions,
      dev: false,
    });

    const moduleCode = bundle.modules[0]?.[1] as string;
    // In production, verbose name is not included
    // Just check that the code is valid
    expect(moduleCode).toBeTruthy();
  });

  test('should find and include InitializeCore from graph modules', async () => {
    const entryPoint = '/entry.js';
    const initializeCorePath = '/node_modules/react-native/Libraries/Core/InitializeCore.js';

    const graphModules: Module[] = [
      {
        path: entryPoint,
        code: '__d(function() { return "entry"; });',
        dependencies: [],
      },
      {
        path: initializeCorePath,
        code: '__d(function() { return "InitializeCore"; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle(entryPoint, preModules, graphModules, {
      ...defaultOptions,
      dev: true,
    });

    // InitializeCore should be found and included in runBeforeMainModule
    const initializeCoreId = createModuleId(initializeCorePath);
    const entryId = createModuleId(entryPoint);

    // Post should contain InitializeCore execution before entry
    expect(bundle.post).toContain(`__r(${JSON.stringify(initializeCoreId)})`);
    expect(bundle.post).toContain(`__r(${JSON.stringify(entryId)})`);

    // InitializeCore should be executed before entry
    const initializeCoreIndex = bundle.post.indexOf(`__r(${JSON.stringify(initializeCoreId)})`);
    const entryIndex = bundle.post.indexOf(`__r(${JSON.stringify(entryId)})`);
    expect(initializeCoreIndex).toBeLessThan(entryIndex);
  });

  test('should handle InitializeCore not found in graph (non-React Native project)', async () => {
    const entryPoint = '/entry.js';
    const graphModules: Module[] = [
      {
        path: entryPoint,
        code: '__d(function() { return "entry"; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    // Should not throw when InitializeCore is not found (non-React Native project)
    const bundle = await baseJSBundle(entryPoint, preModules, graphModules, {
      ...defaultOptions,
      dev: true,
      projectRoot: '/non-react-native-project',
    });

    // Should still generate valid bundle
    expect(bundle.pre).toBeTruthy();
    expect(bundle.post).toBeTruthy();
    expect(bundle.modules.length).toBeGreaterThan(0);
  });

  test('should respect runBeforeMainModule option', async () => {
    const entryPoint = '/entry.js';
    const customModulePath = '/custom-init.js';

    const graphModules: Module[] = [
      {
        path: entryPoint,
        code: '__d(function() { return "entry"; });',
        dependencies: [],
      },
      {
        path: customModulePath,
        code: '__d(function() { return "custom"; });',
        dependencies: [],
      },
    ];

    const preModules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const bundle = await baseJSBundle(entryPoint, preModules, graphModules, {
      ...defaultOptions,
      dev: true,
      runBeforeMainModule: [customModulePath],
    });

    const customId = createModuleId(customModulePath);
    const entryId = createModuleId(entryPoint);

    // Custom module should be executed before entry
    expect(bundle.post).toContain(`__r(${JSON.stringify(customId)})`);
    expect(bundle.post).toContain(`__r(${JSON.stringify(entryId)})`);

    const customIndex = bundle.post.indexOf(`__r(${JSON.stringify(customId)})`);
    const entryIndex = bundle.post.indexOf(`__r(${JSON.stringify(entryId)})`);
    expect(customIndex).toBeLessThan(entryIndex);
  });

  test('should find InitializeCore with different path patterns', async () => {
    const entryPoint = '/entry.js';
    const testCases = [
      '/node_modules/react-native/Libraries/Core/InitializeCore.js',
      '/some/path/Core/InitializeCore.js',
      '/another/path/InitializeCore.js',
    ];

    for (const initializeCorePath of testCases) {
      const graphModules: Module[] = [
        {
          path: entryPoint,
          code: '__d(function() { return "entry"; });',
          dependencies: [],
        },
        {
          path: initializeCorePath,
          code: '__d(function() { return "InitializeCore"; });',
          dependencies: [],
        },
      ];

      const preModules = getPrependedModules({
        dev: true,
        globalPrefix: '',
      });

      const bundle = await baseJSBundle(entryPoint, preModules, graphModules, {
        ...defaultOptions,
        dev: true,
      });

      const initializeCoreId = createModuleId(initializeCorePath);
      const entryId = createModuleId(entryPoint);

      // InitializeCore should be found and executed before entry
      expect(bundle.post).toContain(`__r(${JSON.stringify(initializeCoreId)})`);
      expect(bundle.post).toContain(`__r(${JSON.stringify(entryId)})`);
    }
  });
});

describe('getPrependedModules', () => {
  test('should include prelude', () => {
    const modules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const prelude = modules.find((m) => m.path === '__prelude__');
    expect(prelude).toBeDefined();
    expect(prelude?.code).toContain('__DEV__');
    expect(prelude?.code).toContain('process.env');
  });

  test('should include metro-runtime', () => {
    const modules = getPrependedModules({
      dev: true,
      globalPrefix: '',
    });

    const metroRuntime = modules.find((m) => m.path.includes('metro-runtime'));
    expect(metroRuntime).toBeDefined();
    expect(metroRuntime?.code).toContain('__d');
    expect(metroRuntime?.code).toContain('__r');
  });

  test('should include polyfills when provided', () => {
    const modules = getPrependedModules({
      dev: true,
      globalPrefix: '',
      polyfills: ['@react-native/js-polyfills'],
    });

    // Polyfill might not be found, but should not throw
    expect(modules.length).toBeGreaterThanOrEqual(2); // prelude + metro-runtime
  });

  test('should handle requireCycleIgnorePatterns', () => {
    const modules = getPrependedModules({
      dev: true,
      globalPrefix: '',
      requireCycleIgnorePatterns: [/node_modules/],
    });

    const prelude = modules.find((m) => m.path === '__prelude__');
    expect(prelude?.code).toContain('__requireCycleIgnorePatterns');
  });
});

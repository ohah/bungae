import { describe, test, expect } from 'bun:test';

import { addParamsToDefineCall } from '../helpers/addParamsToDefineCall';
import { wrapModule, getModuleParams, isJsModule } from '../helpers/js';
import { processModules } from '../helpers/processModules';
import type { Module, SerializerOptions } from '../types';

describe('Serializer Helpers', () => {
  describe('addParamsToDefineCall', () => {
    test('should add parameters to __d() call', () => {
      const code = '__d(function() { return 1; });';
      const result = addParamsToDefineCall(code, '', 0, [1, 2]);

      expect(result).toContain('0');
      expect(result).toContain('[1,2]');
      expect(result).toContain('__d');
    });

    test('should handle code without __d wrapper', () => {
      const code = 'function() { return 1; }';
      const result = addParamsToDefineCall(code, '', 0, [1]);

      expect(result).toContain('__d');
      expect(result).toContain('0');
    });

    test('should handle undefined parameters', () => {
      const code = '__d(function() { return 1; });';
      const result = addParamsToDefineCall(code, '', 0, undefined, 'path');

      expect(result).toContain('undefined');
      expect(result).toContain('"path"');
    });
  });

  describe('wrapModule', () => {
    const createOptions = (): SerializerOptions => ({
      createModuleId: (path) => {
        const map: Record<string, number> = {
          '/module1.js': 0,
          '/module2.js': 1,
        };
        return map[path] ?? 0;
      },
      getRunModuleStatement: (id) => `require(${id});`,
      dev: true,
      projectRoot: '/project',
      serverRoot: '/project',
      globalPrefix: '',
      runModule: true,
    });

    test('should wrap module code with __d()', async () => {
      const module: Module = {
        path: '/module1.js',
        code: 'function(require, module, exports) { exports.foo = "bar"; }',
        dependencies: [],
      };

      const result = await wrapModule(module, createOptions());

      expect(result).toContain('__d');
      expect(result).toContain('0'); // moduleId
    });

    test('should include dependencies in __d() call', async () => {
      const module: Module = {
        path: '/module1.js',
        code: 'function(require) { const m2 = require("./module2"); }',
        dependencies: ['/module2.js'],
      };

      const result = await wrapModule(module, createOptions());

      expect(result).toContain('1'); // dependency moduleId
    });

    test('should include verbose name in dev mode', async () => {
      const module: Module = {
        path: '/project/src/module.js',
        code: 'function() { return 1; }',
        dependencies: [],
      };

      const result = await wrapModule(module, createOptions());

      expect(result).toContain('src/module.js');
    });
  });

  describe('getModuleParams', () => {
    const createOptions = (): SerializerOptions => ({
      createModuleId: (path) => {
        const map: Record<string, number> = {
          '/module1.js': 0,
          '/module2.js': 1,
        };
        return map[path] ?? 0;
      },
      getRunModuleStatement: (id) => `require(${id});`,
      dev: true,
      projectRoot: '/project',
      serverRoot: '/project',
      globalPrefix: '',
      runModule: true,
    });

    test('should return moduleId and dependencies', async () => {
      const module: Module = {
        path: '/module1.js',
        code: 'function() { return 1; }',
        dependencies: ['/module2.js'],
      };

      const params = await getModuleParams(module, createOptions());

      expect(params[0]).toBe(0); // moduleId
      expect(params[1]).toEqual([1]); // dependencies
    });

    test('should include verbose name in dev mode', async () => {
      const module: Module = {
        path: '/project/src/module.js',
        code: 'function() { return 1; }',
        dependencies: [],
      };

      const params = await getModuleParams(module, createOptions());

      expect(params.length).toBe(3); // moduleId, dependencies, verboseName
      expect(params[2]).toContain('src/module.js');
    });
  });

  describe('isJsModule', () => {
    test('should return true for .js files', () => {
      const module: Module = {
        path: '/test.js',
        code: '',
        dependencies: [],
      };

      expect(isJsModule(module)).toBe(true);
    });

    test('should return true for .jsx files', () => {
      const module: Module = {
        path: '/test.jsx',
        code: '',
        dependencies: [],
      };

      expect(isJsModule(module)).toBe(true);
    });

    test('should return true for .ts files', () => {
      const module: Module = {
        path: '/test.ts',
        code: '',
        dependencies: [],
      };

      expect(isJsModule(module)).toBe(true);
    });

    test('should return true for .tsx files', () => {
      const module: Module = {
        path: '/test.tsx',
        code: '',
        dependencies: [],
      };

      expect(isJsModule(module)).toBe(true);
    });

    test('should return true for .json files', () => {
      const module: Module = {
        path: '/test.json',
        code: '',
        dependencies: [],
      };

      expect(isJsModule(module)).toBe(true);
    });

    test('should return false for non-JS files', () => {
      const module: Module = {
        path: '/test.png',
        code: '',
        dependencies: [],
      };

      expect(isJsModule(module)).toBe(false);
    });
  });

  describe('Script Module Handling', () => {
    const createOptions = (): SerializerOptions => ({
      createModuleId: (_path) => 0,
      getRunModuleStatement: (id) => `require(${id});`,
      dev: true,
      projectRoot: '/project',
      serverRoot: '/project',
      globalPrefix: '',
      runModule: true,
    });

    test('should return virtual script code as-is without transformation', async () => {
      const module: Module = {
        path: '__prelude__',
        code: 'var __DEV__=true;',
        dependencies: [],
        type: 'js/script/virtual',
      };

      const result = await wrapModule(module, createOptions());

      expect(result).toBe('var __DEV__=true;');
    });

    test('should wrap script modules in IIFE with global parameter', async () => {
      const module: Module = {
        path: '/polyfills/error-guard.js',
        code: 'global.ErrorUtils = {};',
        dependencies: [],
        type: 'js/script',
      };

      const result = await wrapModule(module, createOptions());

      // Should be wrapped in IIFE
      expect(result).toContain('(function (global)');
      expect(result).toContain('globalThis');
      // Should contain the original code
      expect(result).toContain('ErrorUtils');
    });

    test('should handle metro-runtime polyfill that is already wrapped', async () => {
      const module: Module = {
        path: '/node_modules/metro-runtime/src/polyfills/require.js',
        code: '(function (global) { global.__r = function() {}; })',
        dependencies: [],
        type: 'js/script',
      };

      const result = await wrapModule(module, createOptions());

      // Should call the existing IIFE with globalThis fallback
      expect(result).toContain('globalThis');
      expect(result).toContain('global.__r');
    });
  });

  describe('processModules', () => {
    const createOptions = (): SerializerOptions => ({
      createModuleId: (path) => {
        const map: Record<string, number> = {
          '/module1.js': 0,
          '/module2.js': 1,
        };
        return map[path] ?? 0;
      },
      getRunModuleStatement: (id) => `require(${id});`,
      dev: true,
      projectRoot: '/project',
      serverRoot: '/project',
      globalPrefix: '',
      runModule: true,
    });

    test('should process JS modules', async () => {
      const modules: Module[] = [
        {
          path: '/module1.js',
          code: 'function() { return 1; }',
          dependencies: [],
        },
        {
          path: '/module2.js',
          code: 'function() { return 2; }',
          dependencies: [],
        },
      ];

      const result = await processModules(modules, createOptions());

      expect(result.length).toBe(2);
      const firstResult = result[0];
      expect(firstResult).toBeDefined();
      expect(firstResult).not.toBeNull();
      expect(firstResult).not.toBeUndefined();
      // TypeScript doesn't narrow the type after destructuring, so we assert
      const resultTuple = firstResult as [Module, string];
      const module: Module = resultTuple[0];
      const code: string = resultTuple[1];
      const expectedModule = modules[0];
      if (expectedModule) {
        expect(module).toBe(expectedModule);
      }
      expect(code).toContain('__d');
    });

    test('should wrap JSON modules with __d() (Metro-compatible)', async () => {
      const modules: Module[] = [
        {
          path: '/module1.js',
          code: 'function() { return 1; }',
          dependencies: [],
        },
        {
          path: '/data.json',
          code: '{}',
          dependencies: [],
        },
      ];

      const result = await processModules(modules, createOptions());

      // Both JS and JSON modules should be wrapped with __d() (Metro-compatible)
      expect(result.length).toBe(2);
      expect(result.find(([m]) => m.path === '/module1.js')?.[1]).toContain('__d');
      expect(result.find(([m]) => m.path === '/data.json')?.[1]).toContain('__d');
    });

    test('should respect processModuleFilter', async () => {
      const modules: Module[] = [
        {
          path: '/module1.js',
          code: 'function() { return 1; }',
          dependencies: [],
        },
        {
          path: '/module2.js',
          code: 'function() { return 2; }',
          dependencies: [],
        },
      ];

      const options = {
        ...createOptions(),
        processModuleFilter: (module: Module) => module.path === '/module1.js',
      };

      const result = await processModules(modules, options);

      expect(result.length).toBe(1);
      const firstResult = result[0];
      expect(firstResult).toBeDefined();
      expect(firstResult![0].path).toBe('/module1.js');
    });
  });
});

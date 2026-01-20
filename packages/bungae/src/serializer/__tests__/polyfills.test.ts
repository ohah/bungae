/**
 * Polyfill Loading Tests
 *
 * Tests for React Native polyfill loading in getPrependedModules
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getPrependedModules } from '../baseJSBundle';

describe('Polyfill Loading', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-polyfill-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getPrependedModules', () => {
    test('should always include prelude as first module', () => {
      const modules = getPrependedModules({
        dev: true,
        globalPrefix: '',
        projectRoot: testDir,
      });

      expect(modules.length).toBeGreaterThan(0);
      expect(modules[0]?.path).toBe('__prelude__');
      expect(modules[0]?.type).toBe('js/script/virtual');
    });

    test('should include __DEV__ in prelude for dev mode', () => {
      const modules = getPrependedModules({
        dev: true,
        globalPrefix: '',
        projectRoot: testDir,
      });

      const prelude = modules.find((m) => m.path === '__prelude__');
      expect(prelude?.code).toContain('__DEV__=true');
    });

    test('should include __DEV__=false in prelude for production mode', () => {
      const modules = getPrependedModules({
        dev: false,
        globalPrefix: '',
        projectRoot: testDir,
      });

      const prelude = modules.find((m) => m.path === '__prelude__');
      expect(prelude?.code).toContain('__DEV__=false');
    });

    test('should include metro-runtime when react-native is available', () => {
      // Use ExampleApp as projectRoot where react-native is installed
      const projectRoot = join(__dirname, '../../../../../examples/ExampleApp');

      const modules = getPrependedModules({
        dev: true,
        globalPrefix: '',
        projectRoot,
      });

      const metroRuntime = modules.find((m) => m.path.includes('metro-runtime'));
      // Only test if react-native is available (metro-runtime resolved)
      if (metroRuntime) {
        expect(metroRuntime.type).toBe('js/script');
        expect(metroRuntime.code).toContain('__d');
        expect(metroRuntime.code).toContain('__r');
      }
    });

    test('should include requireCycleIgnorePatterns in dev mode prelude', () => {
      const modules = getPrependedModules({
        dev: true,
        globalPrefix: '',
        requireCycleIgnorePatterns: [/node_modules/],
        projectRoot: testDir,
      });

      const prelude = modules.find((m) => m.path === '__prelude__');
      expect(prelude?.code).toContain('__requireCycleIgnorePatterns');
      expect(prelude?.code).toContain('node_modules');
    });

    test('should include extraVars in prelude', () => {
      const modules = getPrependedModules({
        dev: true,
        globalPrefix: '',
        extraVars: { __BUNGAE__: true, __CUSTOM_VAR__: 'test' },
        projectRoot: testDir,
      });

      const prelude = modules.find((m) => m.path === '__prelude__');
      expect(prelude?.code).toContain('__BUNGAE__=true');
      expect(prelude?.code).toContain('__CUSTOM_VAR__="test"');
    });

    test('should include globalPrefix in prelude', () => {
      const modules = getPrependedModules({
        dev: true,
        globalPrefix: 'MyApp',
        projectRoot: testDir,
      });

      const prelude = modules.find((m) => m.path === '__prelude__');
      expect(prelude?.code).toContain("__METRO_GLOBAL_PREFIX__='MyApp'");
    });

    test('should include custom polyfills when specified with full path', () => {
      // Create a mock polyfill
      const polyfillDir = join(testDir, 'polyfills');
      mkdirSync(polyfillDir, { recursive: true });
      const polyfillPath = join(polyfillDir, 'my-polyfill.js');
      writeFileSync(polyfillPath, 'global.myPolyfill = true;');

      const modules = getPrependedModules({
        dev: true,
        globalPrefix: '',
        polyfills: [polyfillPath], // Use full path instead of package name
        projectRoot: testDir,
      });

      const customPolyfill = modules.find((m) => m.path.includes('my-polyfill'));
      expect(customPolyfill).toBeDefined();
      expect(customPolyfill?.code).toContain('myPolyfill');
    });
  });

  describe('React Native Polyfills', () => {
    // These tests require @react-native/js-polyfills to be installed
    // They will be skipped if the package is not found

    test('should include @react-native/js-polyfills when available', () => {
      // Use the actual project root where @react-native/js-polyfills is installed
      const projectRoot = join(__dirname, '../../../../..');

      const modules = getPrependedModules({
        dev: true,
        globalPrefix: '',
        projectRoot,
      });

      // Check if error-guard.js is included
      const errorGuard = modules.find((m) => m.path.includes('error-guard'));
      if (errorGuard) {
        expect(errorGuard.type).toBe('js/script');
        expect(errorGuard.code).toContain('ErrorUtils');
      }

      // Check if console.js is included
      const consolePolyfill = modules.find((m) => m.path.includes('console.js'));
      if (consolePolyfill) {
        expect(consolePolyfill.type).toBe('js/script');
      }
    });

    test('metro-runtime should be loaded before polyfills', () => {
      // Use the actual project root where @react-native/js-polyfills is installed
      const projectRoot = join(__dirname, '../../../../..');

      const modules = getPrependedModules({
        dev: true,
        globalPrefix: '',
        projectRoot,
      });

      const errorGuardIndex = modules.findIndex((m) => m.path.includes('error-guard'));
      const metroRuntimeIndex = modules.findIndex((m) => m.path.includes('metro-runtime'));

      // If both are found, metro-runtime should come before error-guard (Metro order)
      if (errorGuardIndex !== -1 && metroRuntimeIndex !== -1) {
        expect(metroRuntimeIndex).toBeLessThan(errorGuardIndex);
      }
    });
  });

  describe('Module Order', () => {
    test('modules should be in correct order: prelude -> metro-runtime -> polyfills', () => {
      const projectRoot = join(__dirname, '../../../../..');

      const modules = getPrependedModules({
        dev: true,
        globalPrefix: '',
        projectRoot,
      });

      const preludeIndex = modules.findIndex((m) => m.path === '__prelude__');
      const metroRuntimeIndex = modules.findIndex((m) => m.path.includes('metro-runtime'));
      const errorGuardIndex = modules.findIndex((m) => m.path.includes('error-guard'));

      // Prelude should always be first
      expect(preludeIndex).toBe(0);

      // Metro runtime should be right after prelude (index 1)
      if (metroRuntimeIndex !== -1) {
        expect(metroRuntimeIndex).toBe(1);
      }

      // Polyfills should come after metro-runtime
      if (errorGuardIndex !== -1 && metroRuntimeIndex !== -1) {
        expect(errorGuardIndex).toBeGreaterThan(metroRuntimeIndex);
      }
    });
  });
});

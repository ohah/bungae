import { describe, expect, test } from 'bun:test';
import { VERSION, defineConfig } from '../index';
import type { BungaeConfig } from '../index';

describe('bungae', () => {
  describe('VERSION', () => {
    test('should be defined', () => {
      expect(VERSION).toBeDefined();
      expect(typeof VERSION).toBe('string');
    });

    test('should match semver format', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('defineConfig', () => {
    test('should return the same config object', () => {
      const config: BungaeConfig = {
        entry: 'index.js',
        platform: 'ios',
      };

      const result = defineConfig(config);
      expect(result).toEqual(config);
    });

    test('should accept empty config', () => {
      const result = defineConfig({});
      expect(result).toEqual({});
    });

    test('should accept full config', () => {
      const config: BungaeConfig = {
        root: '/path/to/project',
        entry: 'index.js',
        platform: 'android',
        dev: true,
        minify: false,
        outDir: 'dist',
      };

      const result = defineConfig(config);
      expect(result).toEqual(config);
    });
  });
});

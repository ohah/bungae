/**
 * Tests for persistent cache
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

import { PersistentCache } from '../graph-bundler/cache';

describe('PersistentCache', () => {
  const testCacheDir = join(process.cwd(), '.test-cache');

  beforeEach(() => {
    // Clean up test cache directory
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true, force: true });
    }
    mkdirSync(testCacheDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test cache directory
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  it('should cache and retrieve entries', () => {
    const cache = new PersistentCache({ cacheDir: testCacheDir });
    const filePath = '/test/file.js';
    const config = {
      platform: 'ios' as const,
      dev: true,
      root: '/test',
    };

    const entry = {
      code: 'console.log("test");',
      dependencies: ['dep1', 'dep2'],
      sourceMap: '{"version":3}',
      timestamp: Date.now(),
    };

    cache.set(filePath, config, entry);

    const retrieved = cache.get(filePath, config);
    expect(retrieved).toBeDefined();
    expect(retrieved?.code).toBe(entry.code);
    expect(retrieved?.dependencies).toEqual(entry.dependencies);
    expect(retrieved?.sourceMap).toBe(entry.sourceMap);
  });

  it('should return null for non-existent entries', () => {
    const cache = new PersistentCache({ cacheDir: testCacheDir });
    const filePath = '/test/nonexistent.js';
    const config = {
      platform: 'ios' as const,
      dev: true,
      root: '/test',
    };

    const retrieved = cache.get(filePath, config);
    expect(retrieved).toBeNull();
  });

  it('should handle different configs as different cache keys', () => {
    const cache = new PersistentCache({ cacheDir: testCacheDir });
    const filePath = '/test/file.js';

    const entry1 = {
      code: 'ios code',
      dependencies: [],
      timestamp: Date.now(),
    };

    const entry2 = {
      code: 'android code',
      dependencies: [],
      timestamp: Date.now(),
    };

    cache.set(filePath, { platform: 'ios', dev: true, root: '/test' }, entry1);
    cache.set(filePath, { platform: 'android', dev: true, root: '/test' }, entry2);

    const iosEntry = cache.get(filePath, { platform: 'ios', dev: true, root: '/test' });
    const androidEntry = cache.get(filePath, { platform: 'android', dev: true, root: '/test' });

    expect(iosEntry?.code).toBe('ios code');
    expect(androidEntry?.code).toBe('android code');
  });

  it('should clear cache', () => {
    const cache = new PersistentCache({ cacheDir: testCacheDir });
    const filePath = '/test/file.js';
    const config = {
      platform: 'ios' as const,
      dev: true,
      root: '/test',
    };

    const entry = {
      code: 'test',
      dependencies: [],
      timestamp: Date.now(),
    };

    cache.set(filePath, config, entry);
    expect(cache.get(filePath, config)).toBeDefined();

    cache.clear();
    expect(cache.get(filePath, config)).toBeNull();
  });

  it('should get cache statistics', () => {
    const cache = new PersistentCache({ cacheDir: testCacheDir });
    const filePath = '/test/file.js';
    const config = {
      platform: 'ios' as const,
      dev: true,
      root: '/test',
    };

    const entry = {
      code: 'test',
      dependencies: [],
      timestamp: Date.now(),
    };

    cache.set(filePath, config, entry);

    const stats = cache.getStats();
    expect(stats.entries).toBeGreaterThan(0);
    expect(stats.size).toBeGreaterThan(0);
  });

  it('should handle cache expiration', () => {
    const cache = new PersistentCache({
      cacheDir: testCacheDir,
      maxAge: 100, // 100ms expiration for testing
    });
    const filePath = '/test/file.js';
    const config = {
      platform: 'ios' as const,
      dev: true,
      root: '/test',
    };

    const entry = {
      code: 'test',
      dependencies: [],
      timestamp: Date.now(),
    };

    cache.set(filePath, config, entry);
    expect(cache.get(filePath, config)).toBeDefined();

    // Wait for cache to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const retrieved = cache.get(filePath, config);
        expect(retrieved).toBeNull(); // Cache should be expired
        resolve();
      }, 150);
    });
  });
});

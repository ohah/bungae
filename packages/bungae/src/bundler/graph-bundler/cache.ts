/**
 * Persistent cache for transformation results
 * Uses file system to cache transformed modules
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

export interface CacheEntry {
  code: string;
  ast?: any;
  sourceMap?: string;
  dependencies: string[];
  timestamp: number;
}

export interface CacheOptions {
  /** Cache directory */
  cacheDir: string;
  /** Maximum cache age in milliseconds (default: 7 days) */
  maxAge?: number;
}

/**
 * Create a cache key from file path and config
 */
function createCacheKey(
  filePath: string,
  config: {
    platform: string;
    dev: boolean;
    root: string;
  },
): string {
  const hash = createHash('sha256');
  hash.update(filePath);
  hash.update(config.platform);
  hash.update(String(config.dev));
  hash.update(config.root);
  return hash.digest('hex');
}

/**
 * Get cache file path for a module
 */
function getCacheFilePath(cacheDir: string, cacheKey: string): string {
  // Use first 2 characters for directory structure to avoid too many files in one directory
  const dir = join(cacheDir, cacheKey.substring(0, 2));
  mkdirSync(dir, { recursive: true });
  return join(dir, `${cacheKey}.json`);
}

/**
 * Persistent cache for transformation results
 */
export class PersistentCache {
  private cacheDir: string;
  private maxAge: number;

  constructor(options: CacheOptions) {
    this.cacheDir = options.cacheDir;
    this.maxAge = options.maxAge ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    mkdirSync(this.cacheDir, { recursive: true });
  }

  /**
   * Get cached entry for a file
   */
  get(
    filePath: string,
    config: {
      platform: string;
      dev: boolean;
      root: string;
    },
  ): CacheEntry | null {
    const cacheKey = createCacheKey(filePath, config);
    const cacheFilePath = getCacheFilePath(this.cacheDir, cacheKey);

    if (!existsSync(cacheFilePath)) {
      return null;
    }

    try {
      // Check file modification time
      const stats = statSync(cacheFilePath);
      const age = Date.now() - stats.mtimeMs;
      if (age > this.maxAge) {
        // Cache expired, delete it
        try {
          require('fs').unlinkSync(cacheFilePath);
        } catch {
          // Ignore deletion errors
        }
        return null;
      }

      // Check if source file is newer than cache
      if (existsSync(filePath)) {
        const sourceStats = statSync(filePath);
        if (sourceStats.mtimeMs > stats.mtimeMs) {
          // Source file is newer, cache is stale
          return null;
        }
      }

      const cacheData = JSON.parse(readFileSync(cacheFilePath, 'utf-8'));
      return cacheData as CacheEntry;
    } catch (error) {
      // Cache file is corrupted or unreadable
      console.warn(`Failed to read cache for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Set cache entry for a file
   */
  set(
    filePath: string,
    config: {
      platform: string;
      dev: boolean;
      root: string;
    },
    entry: CacheEntry,
  ): void {
    const cacheKey = createCacheKey(filePath, config);
    const cacheFilePath = getCacheFilePath(this.cacheDir, cacheKey);

    try {
      // AST is too large to cache, exclude it
      const cacheEntry: Omit<CacheEntry, 'ast'> & { ast?: any } = {
        ...entry,
        ast: undefined, // Don't cache AST (too large, can be regenerated)
      };
      writeFileSync(cacheFilePath, JSON.stringify(cacheEntry), 'utf-8');
    } catch (error) {
      console.warn(`Failed to write cache for ${filePath}:`, error);
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    try {
      const { rmSync } = require('fs');
      if (existsSync(this.cacheDir)) {
        rmSync(this.cacheDir, { recursive: true, force: true });
        mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (error) {
      console.warn('Failed to clear cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; entries: number } {
    let size = 0;
    let entries = 0;

    try {
      const { readdirSync, statSync } = require('fs');
      const dirs = readdirSync(this.cacheDir);
      for (const dir of dirs) {
        const dirPath = join(this.cacheDir, dir);
        if (statSync(dirPath).isDirectory()) {
          const files = readdirSync(dirPath);
          for (const file of files) {
            if (file.endsWith('.json')) {
              const filePath = join(dirPath, file);
              const stats = statSync(filePath);
              size += stats.size;
              entries++;
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return { size, entries };
  }
}

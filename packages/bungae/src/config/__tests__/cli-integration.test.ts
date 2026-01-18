import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

import { loadConfig, resolveConfig } from '../load';
import type { BungaeConfig } from '../types';

describe('CLI Integration', () => {
  const testRoot = join(process.cwd(), '.test-cli');
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    mkdirSync(testRoot, { recursive: true });
    process.chdir(testRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('should merge CLI options with file config', async () => {
    const fileConfig: BungaeConfig = {
      entry: 'app.js',
      platform: 'ios',
      dev: false,
    };
    writeFileSync(join(testRoot, 'bungae.config.json'), JSON.stringify(fileConfig));

    const loaded = await loadConfig(testRoot);
    const cliOverrides: BungaeConfig = {
      platform: 'android',
      dev: true,
    };

    const merged = { ...loaded, ...cliOverrides };
    const resolved = resolveConfig(merged, testRoot);

    expect(resolved.entry).toBe('app.js'); // From file
    expect(resolved.platform).toBe('android'); // From CLI (overrides)
    expect(resolved.dev).toBe(true); // From CLI (overrides)
  });

  test('should use CLI options when no config file exists', async () => {
    const cliConfig: BungaeConfig = {
      entry: 'custom.js',
      platform: 'android',
      dev: true,
    };

    const resolved = resolveConfig(cliConfig, testRoot);

    expect(resolved.entry).toBe('custom.js');
    expect(resolved.platform).toBe('android');
    expect(resolved.dev).toBe(true);
  });
});

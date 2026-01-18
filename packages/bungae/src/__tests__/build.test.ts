/**
 * Copyright (c) 2026 ohah
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { build, resolveConfig, getDefaultConfig } from '../index';

describe('build', () => {
  let testDir: string;
  let entryFile: string;
  let outDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = join(tmpdir(), `bungae-build-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    entryFile = join(testDir, 'index.js');
    outDir = join(testDir, 'dist');
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should build bundle for iOS', async () => {
    // Create entry file
    writeFileSync(entryFile, "console.log('hello ios');", 'utf-8');

    const defaultConfig = getDefaultConfig(testDir);
    const config = resolveConfig(
      {
        ...defaultConfig,
        entry: 'index.js',
        platform: 'ios',
        outDir: 'dist',
      },
      testDir,
    );

    await build(config);

    // Check if bundle file was created
    const bundlePath = join(outDir, 'index.jsbundle');
    expect(existsSync(bundlePath)).toBe(true);

    // Check bundle content
    const bundleContent = readFileSync(bundlePath, 'utf-8');
    expect(bundleContent).toContain('__BUNGAE__');
    expect(bundleContent.length).toBeGreaterThan(0);
  });

  test('should build bundle for Android', async () => {
    writeFileSync(entryFile, "console.log('hello android');", 'utf-8');

    const defaultConfig = getDefaultConfig(testDir);
    const config = resolveConfig(
      {
        ...defaultConfig,
        entry: 'index.js',
        platform: 'android',
        outDir: 'dist',
      },
      testDir,
    );

    await build(config);

    // Check if bundle file was created with correct name
    const bundlePath = join(outDir, 'index.android.bundle');
    expect(existsSync(bundlePath)).toBe(true);
  });

  test('should build bundle for web', async () => {
    writeFileSync(entryFile, "console.log('hello web');", 'utf-8');

    const defaultConfig = getDefaultConfig(testDir);
    const config = resolveConfig(
      {
        ...defaultConfig,
        entry: 'index.js',
        platform: 'web',
        outDir: 'dist',
      },
      testDir,
    );

    await build(config);

    // Check if bundle file was created with correct name
    const bundlePath = join(outDir, 'index.bundle.js');
    expect(existsSync(bundlePath)).toBe(true);
  });

  test('should create output directory if it does not exist', async () => {
    writeFileSync(entryFile, "console.log('hello');", 'utf-8');

    const customOutDir = join(testDir, 'custom-output');
    const defaultConfig = getDefaultConfig(testDir);
    const config = resolveConfig(
      {
        ...defaultConfig,
        entry: 'index.js',
        platform: 'ios',
        outDir: 'custom-output',
      },
      testDir,
    );

    await build(config);

    expect(existsSync(customOutDir)).toBe(true);
    expect(existsSync(join(customOutDir, 'index.jsbundle'))).toBe(true);
  });

  test('should handle entry file with different extensions', async () => {
    // Test with .tsx entry
    const tsxEntry = join(testDir, 'index.tsx');
    writeFileSync(tsxEntry, "console.log('hello tsx');", 'utf-8');

    const defaultConfig = getDefaultConfig(testDir);
    const config = resolveConfig(
      {
        ...defaultConfig,
        entry: 'index.tsx',
        platform: 'ios',
        outDir: 'dist',
      },
      testDir,
    );

    await build(config);

    // Should create index.jsbundle (entry base name without extension)
    const bundlePath = join(outDir, 'index.jsbundle');
    expect(existsSync(bundlePath)).toBe(true);
  });
});

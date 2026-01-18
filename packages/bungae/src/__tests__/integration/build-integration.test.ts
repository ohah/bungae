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

import { build, resolveConfig, getDefaultConfig } from '../../index';
import { execBundle } from './execBundle';

describe('Build Integration Tests', () => {
  let testDir: string;
  let basicBundleDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-integration-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    basicBundleDir = join(testDir, 'basic_bundle');
    mkdirSync(basicBundleDir, { recursive: true });

    // Create test bundle files (matching Metro's basic_bundle structure)
    // Metro's TestBundle.js includes TypeScript module, but we'll test without it first
    writeFileSync(
      join(basicBundleDir, 'TestBundle.js'),
      `const Bar = require('./Bar');\nconst Foo = require('./Foo');\n\nObject.keys({...Bar});\n\nmodule.exports = {Foo, Bar};`,
      'utf-8',
    );
    // Metro's Foo.js uses asset, but we'll use simpler version for now
    writeFileSync(
      join(basicBundleDir, 'Foo.js'),
      `module.exports = {\n  foo: 'foo',\n  getFoo: () => 'foo',\n};`,
      'utf-8',
    );
    // Metro's Bar.js requires Foo, but we'll use simpler version for now
    writeFileSync(
      join(basicBundleDir, 'Bar.js'),
      `module.exports = {\n  bar: 'bar',\n  getBar: () => 'bar',\n};`,
      'utf-8',
    );
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should build and execute a simple bundle', async () => {
    const defaultConfig = getDefaultConfig(testDir);
    const config = resolveConfig(
      {
        ...defaultConfig,
        entry: 'basic_bundle/TestBundle.js',
        platform: 'ios',
        outDir: 'dist',
      },
      testDir,
    );

    await build(config);

    // Read and execute bundle (file name is based on entry base name)
    const bundlePath = join(testDir, 'dist', 'TestBundle.jsbundle');
    expect(existsSync(bundlePath)).toBe(true);

    const bundleCode = readFileSync(bundlePath, 'utf-8');

    // Execute bundle and verify result (Metro-style)
    // Metro uses execBundle and toMatchSnapshot() for bundle execution verification
    // Note: Our test files are simpler than Metro's (no TypeScript, no assets)
    // Metro's snapshot includes {Foo, Bar, TypeScript} with assets
    // Our snapshot includes {Foo, Bar} with simpler structure
    // The snapshot format is the same, but content differs due to different test files
    const result = execBundle(bundleCode);
    expect(result).toMatchSnapshot();
  });

  test('should build bundle with dependencies correctly', async () => {
    const defaultConfig = getDefaultConfig(testDir);
    const config = resolveConfig(
      {
        ...defaultConfig,
        entry: 'basic_bundle/TestBundle.js',
        platform: 'ios',
        outDir: 'dist',
      },
      testDir,
    );

    await build(config);

    const bundlePath = join(testDir, 'dist', 'TestBundle.jsbundle');
    const bundleCode = readFileSync(bundlePath, 'utf-8');

    // Bundle should contain module definitions
    expect(bundleCode).toContain('__BUNGAE__');
    expect(bundleCode).toContain('__d(');
    expect(bundleCode).toContain('__r(');

    // Execute bundle and verify (Metro-style)
    // Metro uses toMatchSnapshot() for bundle execution verification
    const result = execBundle(bundleCode);
    expect(result).toMatchSnapshot();
  });

  test('should build bundle for different platforms', async () => {
    const platforms: Array<'ios' | 'android' | 'web'> = ['ios', 'android', 'web'];

    for (const platform of platforms) {
      const defaultConfig = getDefaultConfig(testDir);
      const config = resolveConfig(
        {
          ...defaultConfig,
          entry: 'basic_bundle/TestBundle.js',
          platform,
          outDir: 'dist',
        },
        testDir,
      );

      await build(config);

      let bundlePath: string;
      if (platform === 'ios') {
        bundlePath = join(testDir, 'dist', 'TestBundle.jsbundle');
      } else if (platform === 'android') {
        bundlePath = join(testDir, 'dist', 'TestBundle.android.bundle');
      } else {
        bundlePath = join(testDir, 'dist', 'TestBundle.bundle.js');
      }

      expect(existsSync(bundlePath)).toBe(true);

      // Execute bundle and verify (Metro-style)
      // Metro uses toMatchSnapshot() for bundle execution verification
      const bundleCode = readFileSync(bundlePath, 'utf-8');
      const result = execBundle(bundleCode);
      expect(result).toMatchSnapshot();
    }
  });

  test('should handle TypeScript entry file', async () => {
    // Create TypeScript entry file
    const tsEntry = join(basicBundleDir, 'TestBundle.ts');
    writeFileSync(
      tsEntry,
      `import Bar from './Bar';\nimport Foo from './Foo';\n\nexport { Foo, Bar };`,
      'utf-8',
    );

    // Update Bar and Foo to use ES modules
    writeFileSync(
      join(basicBundleDir, 'Foo.ts'),
      `export default {\n  foo: 'foo',\n  getFoo: () => 'foo',\n};`,
      'utf-8',
    );
    writeFileSync(
      join(basicBundleDir, 'Bar.ts'),
      `export default {\n  bar: 'bar',\n  getBar: () => 'bar',\n};`,
      'utf-8',
    );

    const defaultConfig = getDefaultConfig(testDir);
    const config = resolveConfig(
      {
        ...defaultConfig,
        entry: 'basic_bundle/TestBundle.ts',
        platform: 'ios',
        outDir: 'dist',
      },
      testDir,
    );

    await build(config);

    // File name is based on entry base name (TestBundle.ts -> TestBundle.jsbundle)
    const bundlePath = join(testDir, 'dist', 'TestBundle.jsbundle');
    expect(existsSync(bundlePath)).toBe(true);
  });
});

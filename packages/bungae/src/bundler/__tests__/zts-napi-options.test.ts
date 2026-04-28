import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getDefaultConfig, resolveConfig } from '../../config';
import {
  readTsConfigPathAliases,
  resolveEffectiveTransformConfig,
} from '../zts-bundler/napi-build';
import { createMetroResolveRequestPlugin } from '../zts-bundler/napi-plugins';

describe('zts NAPI options', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-zts-napi-options-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('tsconfig trailing wildcard paths become ZTS aliases', () => {
    writeFileSync(
      join(testDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          paths: {
            '@/*': ['./*'],
          },
        },
      }),
      'utf8',
    );

    expect(readTsConfigPathAliases(testDir)).toEqual({
      '@': testDir,
    });
  });

  test('non-prefix-safe paths are ignored', () => {
    writeFileSync(
      join(testDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          paths: {
            '@exact': ['./src/index.ts'],
            'pkg/*/test': ['./src/*/test'],
          },
        },
      }),
      'utf8',
    );

    expect(readTsConfigPathAliases(testDir)).toEqual({});
  });

  test('getTransformOptions inlineRequires updates effective JS config without ZTS option plumbing', async () => {
    const events: unknown[] = [];
    const config = resolveConfig(
      {
        ...getDefaultConfig(testDir),
        entry: 'index.js',
        transformer: {
          getTransformOptions: () => ({
            transform: {
              inlineRequires: true,
            },
          }),
        },
        reporter: {
          update: (event) => events.push(event),
        },
      },
      testDir,
    );

    const effective = await resolveEffectiveTransformConfig(config);

    expect(effective.transformer.inlineRequires).toBe(true);
    expect(events).toContainEqual({
      type: 'client_log',
      level: 'warn',
      data: [
        'transformer.getTransformOptions returned inlineRequires, but ZTS does not yet implement the inline require transform.',
      ],
    });
  });

  test('resolveRequest receives Metro-like context and customResolverOptions', () => {
    let onResolve: any = null;
    const plugin = createMetroResolveRequestPlugin({
      platform: 'ios',
      customResolverOptions: { flavor: 'debug' },
      sourceExts: ['.js'],
      assetExts: ['.png'],
      nodeModulesPaths: ['/tmp/node_modules'],
      mainFields: ['react-native', 'main'],
      preferNativePlatform: true,
      resolveRequest: (context, moduleName, platform) => {
        expect(moduleName).toBe('example');
        expect(platform).toBe('ios');
        expect(context.originModulePath).toBe('/tmp/App.js');
        expect(context.customResolverOptions).toEqual({ flavor: 'debug' });
        expect(context.sourceExts).toEqual(['.js']);
        expect(context.assetExts).toEqual(['.png']);
        expect(context.nodeModulesPaths).toEqual(['/tmp/node_modules']);
        expect(context.mainFields).toEqual(['react-native', 'main']);
        expect(context.preferNativePlatform).toBe(true);
        return { type: 'sourceFile', filePath: '/tmp/example.js' };
      },
    });

    plugin.setup({
      onResolve: (_filter: unknown, callback: any) => {
        onResolve = callback;
      },
    } as never);

    expect(onResolve?.({ importer: '/tmp/App.js', path: 'example' })).toEqual({
      path: '/tmp/example.js',
    });
  });
});

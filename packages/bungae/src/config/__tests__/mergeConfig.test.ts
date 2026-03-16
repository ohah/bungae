/**
 * Copyright (c) 2026 ohah
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, test, expect } from 'bun:test';

import { mergeConfig } from '../merge';

describe('mergeConfig', () => {
  test('can merge empty configs', () => {
    const result = mergeConfig(
      {
        root: '/test',
        entry: 'index.js',
        platform: 'ios',
        dev: false,
        minify: false,
        outDir: 'dist',
        mode: 'production',
        bundler: 'graph',
        bundleOutput: '',
        sourcemapOutput: '',
        sourcemapSourcesRoot: '',
        sourcemapUseAbsolutePath: false,
        sourceMap: false,
        sourceMapUrl: '',
        assetsDest: '',
        assetCatalogDest: '',
        bundleEncoding: 'utf8',
        resetCache: false,
        maxWorkers: 0,
        watchFolders: [],
        sourceExts: [],
        transformOptions: {},
        resolverOptions: {},
        unstableTransformProfile: 'default',
        interactive: true,
        resolver: {
          sourceExts: [],
          assetExts: [],
          platforms: [],
          preferNativePlatform: true,
          nodeModulesPaths: [],
          blockList: [],
        },
        transformer: {
          minifier: 'bun',
          inlineRequires: false,
          babel: { presets: [], plugins: [] },
        },
        experimental: {
          treeShaking: false,
        },
        serializer: {
          polyfills: [],
          prelude: [],
          bundleType: 'plain',
          extraVars: {},
          getModulesRunBeforeMainModule: () => [],
          getPolyfills: () => [],
          inlineSourceMap: false,
        },
        server: {
          port: 8081,
          host: 'localhost',
          https: false,
          key: '',
          cert: '',
          useGlobalHotkey: true,
          forwardClientLogs: true,
          verifyConnections: false,
          unstable_serverRoot: null,
        },
      },
      {},
    );

    expect(result).toMatchObject({
      resolver: expect.any(Object),
      transformer: expect.any(Object),
      serializer: expect.any(Object),
    });
  });
});

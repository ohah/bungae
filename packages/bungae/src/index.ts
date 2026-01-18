/**
 * Bungae - A lightning-fast React Native bundler powered by Bun
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.1';

// Re-export config types
export type {
  BungaeConfig,
  ResolvedConfig,
  ResolverConfig,
  TransformerConfig,
  SerializerConfig,
  Platform,
  Mode,
  BundleType,
} from './config/types';

// Re-export config utilities
export {
  loadConfig,
  resolveConfig,
  getDefaultConfig,
  mergeConfig,
  defineConfig,
  DEFAULT_RESOLVER,
  DEFAULT_TRANSFORMER,
  DEFAULT_SERIALIZER,
} from './config';

// Re-export resolver
export { createPlatformResolverPlugin } from './resolver';
export type { PlatformResolverOptions } from './resolver';

// Re-export transformer
export { transform } from './transformer';
export type { TransformOptions, TransformResult } from './transformer';

// Re-export serializer
export {
  baseJSBundle,
  getPrependedModules,
  createModuleIdFactory,
  getRunModuleStatement,
} from './serializer';
export type { Module, Bundle, SerializerOptions } from './serializer';

// Re-export graph
export { buildGraph, graphModulesToSerializerModules } from './graph';
export type { GraphBuildOptions, GraphBuildResult, GraphModule } from './graph/types';

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

import type { ResolvedConfig } from './config/types';
import { buildGraph, graphModulesToSerializerModules } from './graph';
import { baseJSBundle, createModuleIdFactory, getRunModuleStatement } from './serializer';

export async function build(config: ResolvedConfig): Promise<void> {
  const { entry, platform, dev, outDir, root, resolver, transformer } = config;

  console.log(`Building bundle for ${platform}...`);
  console.log(`Entry: ${entry}`);
  console.log(`Output: ${outDir}`);

  // Build dependency graph
  const graphResult = await buildGraph({
    entryFile: entry,
    platform,
    dev: dev ?? false,
    projectRoot: root,
    resolver: {
      sourceExts: resolver.sourceExts,
      assetExts: resolver.assetExts,
      platforms: resolver.platforms,
      preferNativePlatform: resolver.preferNativePlatform,
      nodeModulesPaths: resolver.nodeModulesPaths,
    },
    transformer: {
      babel: transformer.babel,
      minifier: transformer.minifier,
      inlineRequires: transformer.inlineRequires,
    },
    onProgress: (processed, total) => {
      if (total > 0) {
        const percent = Math.round((processed / total) * 100);
        process.stdout.write(`\rProcessing modules: ${processed}/${total} (${percent}%)`);
      }
    },
  });

  console.log('\nSerializing bundle...');

  // Convert graph modules to serializer modules
  const graphModules = graphModulesToSerializerModules(graphResult.modules);

  // Get prepended modules (prelude, metro-runtime, polyfills)
  const prepend = graphResult.prepend;

  // Create serializer options
  const createModuleId = createModuleIdFactory();
  const globalPrefix = '__BUNGAE__';
  const serverRoot = config.server?.unstable_serverRoot ?? root;

  // Serialize bundle
  const bundle = await baseJSBundle(graphResult.entryModule.path, prepend, graphModules, {
    createModuleId,
    getRunModuleStatement: (moduleId, prefix) => getRunModuleStatement(moduleId, prefix),
    dev: dev ?? false,
    projectRoot: root,
    serverRoot,
    globalPrefix,
    runModule: true,
    sourceMapUrl: dev ? undefined : undefined, // TODO: Add source map support
  });

  // Combine bundle code
  // bundle.modules already contains the formatted code from processModules
  const modulesCode = bundle.modules.map(([, code]) => code).join('\n');
  const bundleCode = `${bundle.pre}\n${modulesCode}\n${bundle.post}`;

  // Ensure output directory exists
  const outputDir = resolve(root, outDir);
  mkdirSync(outputDir, { recursive: true });

  // Generate bundle file name based on Metro/React Native conventions
  // iOS: {entry}.jsbundle (e.g., index.jsbundle or main.jsbundle)
  // Android: {entry}.android.bundle (e.g., index.android.bundle)
  // Web: {entry}.bundle.js (e.g., index.bundle.js)
  // Extract base name from entry path (handle paths like 'basic_bundle/TestBundle.js')
  const entryBaseName =
    entry
      .split('/')
      .pop()
      ?.replace(/\.(js|ts|jsx|tsx)$/, '') || 'index';
  let bundleFileName: string;
  if (platform === 'ios') {
    bundleFileName = `${entryBaseName}.jsbundle`;
  } else if (platform === 'android') {
    bundleFileName = `${entryBaseName}.android.bundle`;
  } else {
    // web
    bundleFileName = `${entryBaseName}.bundle.js`;
  }

  const bundlePath = join(outputDir, bundleFileName);
  writeFileSync(bundlePath, bundleCode, 'utf-8');

  console.log(`\n✅ Bundle written to: ${bundlePath}`);
  console.log(`   Modules: ${graphModules.length}`);
  console.log(`   Size: ${(bundleCode.length / 1024).toFixed(2)} KB`);
}

export async function serve(config: ResolvedConfig): Promise<void> {
  const { entry, platform, dev, root, resolver, transformer, server } = config;
  const port = server?.port ?? 8081;
  const hostname = 'localhost';

  console.log(`Starting Bungae dev server on http://${hostname}:${port}`);
  console.log(`Entry: ${entry}`);
  console.log(`Platform: ${platform}`);

  // Build dependency graph (will be rebuilt on file changes later)
  let graphResult: Awaited<ReturnType<typeof buildGraph>>;
  let bundle: Awaited<ReturnType<typeof baseJSBundle>>;

  async function rebuildBundle() {
    console.log('Building bundle...');
    graphResult = await buildGraph({
      entryFile: entry,
      platform,
      dev: dev ?? true,
      projectRoot: root,
      resolver: {
        sourceExts: resolver.sourceExts,
        assetExts: resolver.assetExts,
        platforms: resolver.platforms,
        preferNativePlatform: resolver.preferNativePlatform,
        nodeModulesPaths: resolver.nodeModulesPaths,
      },
      transformer: {
        babel: transformer.babel,
        minifier: transformer.minifier,
        inlineRequires: transformer.inlineRequires,
      },
    });

    const graphModules = graphModulesToSerializerModules(graphResult.modules);
    const prepend = graphResult.prepend;

    const createModuleId = createModuleIdFactory();
    const globalPrefix = '__BUNGAE__';
    const serverRoot = server?.unstable_serverRoot ?? root;

    bundle = await baseJSBundle(graphResult.entryModule.path, prepend, graphModules, {
      createModuleId,
      getRunModuleStatement: (moduleId, prefix) => getRunModuleStatement(moduleId, prefix),
      dev: dev ?? true,
      projectRoot: root,
      serverRoot,
      globalPrefix,
      runModule: true,
    });
  }

  // Initial build
  await rebuildBundle();

  // Start HTTP server
  Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url);

      // Handle bundle request
      if (url.pathname.endsWith('.bundle') || url.pathname.endsWith('.bundle.js')) {
        // Rebuild bundle on each request (will be optimized with file watching later)
        await rebuildBundle();

        const modulesCode = bundle.modules.map(([, code]) => code).join('\n');
        const bundleCode = `${bundle.pre}\n${modulesCode}\n${bundle.post}`;

        return new Response(bundleCode, {
          headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-cache',
          },
        });
      }

      // Handle source map request
      if (url.pathname.endsWith('.map')) {
        // TODO: Return source map
        return new Response('{}', {
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }

      // Handle root/index
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(
          `
<!DOCTYPE html>
<html>
<head>
  <title>Bungae Dev Server</title>
</head>
<body>
  <h1>Bungae Dev Server</h1>
  <p>Bundle: <a href="/index.bundle?platform=${platform}">/index.bundle?platform=${platform}</a></p>
</body>
</html>
          `.trim(),
          {
            headers: {
              'Content-Type': 'text/html',
            },
          },
        );
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(`✅ Dev server running at http://${hostname}:${port}`);
  console.log(`   Bundle: http://${hostname}:${port}/index.bundle?platform=${platform}`);
  console.log('\nPress Ctrl+C to stop');
}

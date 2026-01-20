/**
 * Graph Bundler - Uses Bun.build() for transformation + Metro __d()/__r() for module system
 *
 * This approach:
 * 1. Build dependency graph from entry point
 * 2. Transform each module using Bun.build() (fast transformation)
 * 3. Wrap each module with __d() for Metro-compatible module system
 * 4. Serialize using Metro's module execution order
 *
 * Benefits:
 * - Fast transformation via Bun.build()
 * - Correct module execution order via __d()/__r()
 * - Metro-compatible output
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve, relative } from 'path';

import type { ServerWebSocket } from 'bun';

import type { ResolvedConfig } from '../config/types';
import {
  baseJSBundle,
  getPrependedModules,
  createModuleIdFactory,
  getRunModuleStatement,
} from '../serializer';
import type { Module } from '../serializer/types';
import { extractDependencies } from '../transformer/utils';

/**
 * Module in the dependency graph
 */
interface GraphModule {
  path: string;
  code: string;
  transformedCode: string;
  dependencies: string[];
  originalDependencies: string[];
}

/**
 * Build result
 */
export interface BuildResult {
  code: string;
  map?: string;
}

/**
 * Resolve module path with platform-specific extensions
 */
async function resolveModule(
  fromPath: string,
  moduleSpecifier: string,
  config: ResolvedConfig,
): Promise<string | null> {
  const fromDir = dirname(fromPath);
  const { platform, resolver } = config;

  // Handle relative paths
  if (moduleSpecifier.startsWith('.')) {
    const basePath = resolve(fromDir, moduleSpecifier);

    // Build extension priority list
    const extensions: string[] = [];

    // 1. Platform-specific extensions
    if (platform !== 'web') {
      for (const ext of resolver.sourceExts) {
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        extensions.push(`.${platform}${normalizedExt}`);
      }
    }

    // 2. Native extensions (if preferNativePlatform)
    if (resolver.preferNativePlatform && platform !== 'web') {
      for (const ext of resolver.sourceExts) {
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        extensions.push(`.native${normalizedExt}`);
      }
    }

    // 3. Default extensions
    for (const ext of resolver.sourceExts) {
      extensions.push(ext.startsWith('.') ? ext : `.${ext}`);
    }

    // Try each extension
    for (const ext of extensions) {
      const candidate = `${basePath}${ext}`;
      if (
        existsSync(candidate) &&
        !candidate.endsWith('.flow.js') &&
        !candidate.endsWith('.flow')
      ) {
        return candidate;
      }
    }

    // Try without extension (if it's already a file)
    if (existsSync(basePath)) {
      return basePath;
    }

    // Try index files
    for (const ext of extensions) {
      const indexPath = join(basePath, `index${ext}`);
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  // Handle node_modules
  try {
    let resolved = require.resolve(moduleSpecifier, {
      paths: [
        fromDir,
        config.root,
        resolve(config.root, 'node_modules'),
        ...resolver.nodeModulesPaths.map((p) => resolve(config.root, p)),
      ],
    });

    // Skip Flow files
    if (resolved.endsWith('.flow.js') || resolved.endsWith('.flow')) {
      const withoutFlow = resolved.replace(/\.flow(\.js)?$/, '.js');
      if (existsSync(withoutFlow)) {
        resolved = withoutFlow;
      } else {
        return null;
      }
    }

    return resolved;
  } catch {
    // Manual lookup fallback
    const nodeModulesPaths = [
      resolve(config.root, 'node_modules'),
      ...resolver.nodeModulesPaths.map((p) => resolve(config.root, p)),
    ];

    for (const nodeModulesPath of nodeModulesPaths) {
      const packagePath = resolve(nodeModulesPath, moduleSpecifier);
      const extensions = resolver.sourceExts;
      if (extensions.length === 0) {
        continue;
      }
      const firstExt = extensions[0];
      if (!firstExt) {
        continue;
      }
      for (const ext of extensions) {
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        const withExt = `${packagePath}${normalizedExt}`;
        if (existsSync(withExt)) {
          return withExt;
        }
      }
      // Try index file
      const indexPath = resolve(
        packagePath,
        `index${firstExt.startsWith('.') ? firstExt : `.${firstExt}`}`,
      );
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }
  }

  return null;
}

/**
 * Transform a single file using Babel (Metro-compatible)
 * Uses Hermes parser for Flow, Babel for all transformations
 */
async function transformFile(
  filePath: string,
  code: string,
  config: ResolvedConfig,
): Promise<string> {
  const { platform, dev } = config;

  // Skip Flow files and asset files
  if (filePath.endsWith('.flow.js') || filePath.endsWith('.flow')) {
    return '';
  }

  // JSON files: Export as module
  const isJSON = filePath.endsWith('.json');
  if (isJSON) {
    // Wrap JSON as CommonJS module
    return `module.exports = ${code};`;
  }

  // Asset files: Return empty (handled separately)
  const isAsset = config.resolver.assetExts.some((ext) => filePath.endsWith(ext));
  if (isAsset) {
    return '';
  }

  // Use Babel for all transformations (Metro-compatible)
  return transformWithBabel(code, filePath, { dev, platform });
}

/**
 * Transform code using Babel with @react-native/babel-preset (Metro-compatible)
 * Uses the same preset that Metro uses for full compatibility
 */
async function transformWithBabel(
  code: string,
  filePath: string,
  options: { dev: boolean; platform: string },
): Promise<string> {
  const babel = await import('@babel/core');
  const hermesParser = await import('hermes-parser');

  // Parse with Hermes parser (handles Flow syntax like Metro)
  let ast;
  try {
    ast = hermesParser.parse(code, {
      babel: true,
      sourceType: 'module',
    });
  } catch (parseError) {
    // If Hermes parser fails, try Babel parser
    try {
      const result = await babel.parseAsync(code, {
        filename: filePath,
        sourceType: 'module',
        parserOpts: {
          plugins: ['jsx', 'typescript', 'flow'],
        },
      });
      ast = result;
    } catch {
      throw new Error(`Failed to parse ${filePath}: ${parseError}`);
    }
  }

  // Use @react-native/babel-preset (same as Metro)
  // enableBabelRuntime: false inlines helpers instead of importing from @babel/runtime
  // This avoids the need to bundle @babel/runtime separately
  const result = await babel.transformFromAstAsync(ast, code, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    presets: [
      [
        require.resolve('@react-native/babel-preset'),
        {
          dev: options.dev,
          unstable_transformProfile: 'hermes-stable',
          useTransformReactJSXExperimental: false,
          disableStaticViewConfigsCodegen: true,
          enableBabelRuntime: false,
        },
      ],
    ],
    compact: !options.dev,
    comments: options.dev,
  });

  if (!result?.code) {
    // Type-only files may result in empty code
    return 'module.exports = {};';
  }

  return result.code;
}

/**
 * Build dependency graph from entry point
 */
async function buildGraph(
  entryPath: string,
  config: ResolvedConfig,
  onProgress?: (processed: number, total: number) => void,
): Promise<Map<string, GraphModule>> {
  const modules = new Map<string, GraphModule>();
  const visited = new Set<string>();
  const processing = new Set<string>();

  let processedCount = 0;
  let totalCount = 1;

  async function processModule(filePath: string): Promise<void> {
    if (visited.has(filePath) || processing.has(filePath)) {
      return;
    }

    processing.add(filePath);

    // Skip Flow files
    if (filePath.endsWith('.flow.js') || filePath.endsWith('.flow')) {
      visited.add(filePath);
      processing.delete(filePath);
      return;
    }

    // Skip asset files
    const isAsset = config.resolver.assetExts.some((ext) => filePath.endsWith(ext));
    if (isAsset) {
      visited.add(filePath);
      processing.delete(filePath);
      return;
    }

    // Read file
    const code = readFileSync(filePath, 'utf-8');

    // JSON files: No dependencies, just wrap as module
    const isJSON = filePath.endsWith('.json');
    if (isJSON) {
      const module: GraphModule = {
        path: filePath,
        code,
        transformedCode: `module.exports = ${code};`,
        dependencies: [],
        originalDependencies: [],
      };
      modules.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);
      processedCount++;
      onProgress?.(processedCount, totalCount);
      return;
    }

    // Transform code
    const transformedCode = await transformFile(filePath, code, config);

    // Extract dependencies from original code
    const dependencies = await extractDependencies(code, filePath);

    // Resolve dependencies
    const resolvedDependencies: string[] = [];
    const originalDependencies: string[] = [];

    for (const dep of dependencies) {
      if (!dep || !dep.trim()) continue;

      const resolved = await resolveModule(filePath, dep, config);
      if (resolved) {
        resolvedDependencies.push(resolved);
        originalDependencies.push(dep);
      } else if (config.dev) {
        console.warn(`[bungae] Failed to resolve "${dep}" from ${filePath}`);
      }
    }

    // Create module
    const module: GraphModule = {
      path: filePath,
      code,
      transformedCode,
      dependencies: resolvedDependencies,
      originalDependencies,
    };

    modules.set(filePath, module);
    visited.add(filePath);

    processedCount++;
    totalCount = Math.max(totalCount, modules.size + resolvedDependencies.length);
    onProgress?.(processedCount, totalCount);

    // Process dependencies
    for (const dep of resolvedDependencies) {
      if (!visited.has(dep) && !processing.has(dep)) {
        await processModule(dep);
      }
    }

    processing.delete(filePath);
  }

  await processModule(entryPath);

  // Include InitializeCore if not already in graph
  try {
    const initializeCorePath = require.resolve('react-native/Libraries/Core/InitializeCore', {
      paths: [config.root],
    });
    if (!modules.has(initializeCorePath)) {
      await processModule(initializeCorePath);
    }
  } catch {
    // Not a React Native project
  }

  return modules;
}

/**
 * Convert graph modules to serializer modules
 */
function graphToSerializerModules(graph: Map<string, GraphModule>): Module[] {
  return Array.from(graph.values()).map((m) => ({
    path: m.path,
    code: m.transformedCode,
    dependencies: m.dependencies,
    originalDependencies: m.originalDependencies,
    type: 'js/module' as const,
  }));
}

/**
 * Build bundle using Graph + Metro module system
 */
export async function buildWithGraph(config: ResolvedConfig): Promise<BuildResult> {
  const { entry, dev, root } = config;

  const entryPath = resolve(root, entry);
  if (!existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  console.log(`[bungae] Building dependency graph...`);

  // Build dependency graph
  const startTime = Date.now();
  const graph = await buildGraph(entryPath, config, (processed, total) => {
    if (processed % 100 === 0 || processed === total) {
      process.stdout.write(`\r[bungae] Processing modules: ${processed}/${total}`);
    }
  });
  console.log(`\n[bungae] Graph built: ${graph.size} modules in ${Date.now() - startTime}ms`);

  // Convert to serializer modules
  const graphModules = graphToSerializerModules(graph);

  // Get prepended modules (prelude, metro-runtime, polyfills)
  const prependModules = getPrependedModules({
    dev,
    globalPrefix: '',
    polyfills: config.serializer?.polyfills || [],
    extraVars: config.serializer?.extraVars,
    requireCycleIgnorePatterns: [/(^|\/|\\)node_modules($|\/|\\)/],
    projectRoot: root,
  });

  // Create module ID factory
  const createModuleId = createModuleIdFactory();

  // Serialize bundle
  const bundle = await baseJSBundle(entryPath, prependModules, graphModules, {
    createModuleId,
    getRunModuleStatement,
    dev,
    projectRoot: root,
    serverRoot: root,
    globalPrefix: '',
    runModule: true,
    runBeforeMainModule: [],
  });

  // Combine bundle parts
  const code = [
    '// Bungae Bundle (Graph Mode)',
    bundle.pre,
    bundle.modules.map(([, code]) => code).join('\n'),
    bundle.post,
  ].join('\n');

  // TODO: Generate source map
  const map = dev
    ? JSON.stringify({
        version: 3,
        sources: Array.from(graph.keys()).map((p) => relative(root, p)),
        names: [],
        mappings: '',
      })
    : undefined;

  return { code, map };
}

/**
 * HMR WebSocket message types (Metro-compatible)
 */
interface HmrMessage {
  type: string;
  body?: unknown;
}

/**
 * Serve bundle using Graph bundler
 */
export async function serveWithGraph(config: ResolvedConfig): Promise<void> {
  const { platform, server } = config;
  const port = server?.port ?? 8081;
  const hostname = 'localhost';

  console.log(`Starting Bungae dev server (Graph mode) on http://${hostname}:${port}`);

  let cachedBuild: BuildResult | null = null;
  let isBuilding = false;
  let buildPromise: Promise<BuildResult> | null = null;

  // Track connected HMR clients
  const hmrClients = new Set<{ send: (msg: string) => void }>();

  type HmrWsData = { url: string };
  type HmrClient = { send: (msg: string) => void };
  type HmrWs = ServerWebSocket<HmrWsData> & { _client?: HmrClient };

  Bun.serve<HmrWsData>({
    port,
    hostname,
    idleTimeout: 120, // 2 minutes timeout for slow builds
    async fetch(req, server) {
      const url = new URL(req.url);

      // Handle WebSocket upgrade for HMR (Metro protocol)
      // React Native connects to /hot for HMR
      if (url.pathname === '/hot' || url.pathname.startsWith('/hot?')) {
        const upgraded = server.upgrade(req, {
          data: { url: url.toString() } as HmrWsData,
        });
        if (upgraded) {
          return undefined; // Bun handles the upgrade
        }
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      if (url.pathname.endsWith('.bundle') || url.pathname.endsWith('.bundle.js')) {
        try {
          // Use cached build if available
          if (cachedBuild) {
            console.log('Serving cached bundle...');
            const bundleWithMapRef = cachedBuild.map
              ? `${cachedBuild.code}\n//# sourceMappingURL=${url.pathname}.map`
              : cachedBuild.code;

            return new Response(bundleWithMapRef, {
              headers: {
                'Content-Type': 'application/javascript',
                'Cache-Control': 'no-cache',
              },
            });
          }

          // If already building, wait for it
          if (isBuilding && buildPromise) {
            console.log('Waiting for ongoing build...');
            cachedBuild = await buildPromise;
          } else {
            // Start new build
            console.log('Building bundle (Graph mode)...');
            isBuilding = true;
            buildPromise = buildWithGraph(config);
            cachedBuild = await buildPromise;
            isBuilding = false;
            buildPromise = null;
          }

          const bundleWithMapRef = cachedBuild.map
            ? `${cachedBuild.code}\n//# sourceMappingURL=${url.pathname}.map`
            : cachedBuild.code;

          return new Response(bundleWithMapRef, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache',
            },
          });
        } catch (error) {
          isBuilding = false;
          buildPromise = null;
          console.error('Build error:', error);
          return new Response(`// Build error: ${error}`, {
            status: 500,
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
      }

      if (url.pathname === '/status' || url.pathname === '/status.txt') {
        return new Response('packager-status:running', {
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      if (url.pathname.endsWith('.map')) {
        if (cachedBuild?.map) {
          return new Response(cachedBuild.map, {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(
          `<!DOCTYPE html>
<html>
<head><title>Bungae Dev Server (Graph Mode)</title></head>
<body>
<h1>Bungae Dev Server (Graph Mode)</h1>
<p>Bundle: <a href="/index.bundle?platform=${platform}">/index.bundle?platform=${platform}</a></p>
<p>Sourcemap: <a href="/index.bundle.map">/index.bundle.map</a></p>
</body>
</html>`,
          { headers: { 'Content-Type': 'text/html' } },
        );
      }

      return new Response('Not Found', { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<HmrWsData>) {
        console.log('[HMR] Client connected');
        const client: HmrClient = {
          send: (msg: string) => {
            try {
              ws.send(msg);
            } catch {
              // Client disconnected
            }
          },
        };
        hmrClients.add(client);
        // Store reference on ws for cleanup
        (ws as HmrWs)._client = client;
      },
      message(ws, message) {
        try {
          const msg: HmrMessage = JSON.parse(message.toString());
          console.log('[HMR] Received:', msg.type);

          // Handle Metro HMR protocol messages
          switch (msg.type) {
            case 'register-entrypoints':
              // Client is registering after bundle load
              // Send bundle-registered to dismiss loading overlay
              console.log('[HMR] Sending bundle-registered');
              ws.send(JSON.stringify({ type: 'bundle-registered' }));
              break;

            case 'log':
              // Client is sending log messages
              if (msg.body) {
                console.log('[HMR Client]', msg.body);
              }
              break;

            case 'log-opt-in':
              // Client wants to receive log forwarding
              break;

            default:
              console.log('[HMR] Unknown message type:', msg.type);
          }
        } catch (error) {
          console.error('[HMR] Error parsing message:', error);
        }
      },
      close(ws: ServerWebSocket<HmrWsData>) {
        console.log('[HMR] Client disconnected');
        const client = (ws as HmrWs)._client;
        if (client) {
          hmrClients.delete(client);
        }
      },
    },
  });

  console.log(`✅ Dev server (Graph mode) running at http://${hostname}:${port}`);
  console.log(`   HMR endpoint: ws://${hostname}:${port}/hot`);
}

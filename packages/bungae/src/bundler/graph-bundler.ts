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
import { dirname, join, resolve, relative, basename, extname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import type { Server, ServerWebSocket } from 'bun';

import type { ResolvedConfig } from '../config/types';
import {
  baseJSBundle,
  getPrependedModules,
  createModuleIdFactory,
  getRunModuleStatement,
} from '../serializer';
import type { Module } from '../serializer/types';
import { extractDependenciesFromAst } from '../transformer/extract-dependencies-from-ast';
import { createFileWatcher, type FileWatcher } from './file-watcher';

/**
 * Get image dimensions from a PNG file (basic implementation)
 */
function getImageSize(filePath: string): { width: number; height: number } {
  try {
    const buffer = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();

    if (ext === '.png') {
      // PNG: width at offset 16, height at offset 20 (big endian)
      if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      // JPEG: Find SOF0 marker (0xFF 0xC0) and read dimensions
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          // SOF0 or SOF2
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    } else if (ext === '.gif') {
      // GIF: width at offset 6, height at offset 8 (little endian)
      if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
        const width = buffer.readUInt16LE(6);
        const height = buffer.readUInt16LE(8);
        return { width, height };
      }
    }
  } catch {
    // Ignore errors
  }

  // Default size if we can't read the image
  return { width: 0, height: 0 };
}

/**
 * Generate asset module code that registers the asset with AssetRegistry
 */
function generateAssetModuleCode(assetPath: string, projectRoot: string): string {
  const { width, height } = getImageSize(assetPath);
  const name = basename(assetPath, extname(assetPath));
  const type = extname(assetPath).slice(1); // Remove the dot
  const relativePath = relative(projectRoot, dirname(assetPath));

  // Generate Metro-compatible asset registration
  return `module.exports = require("react-native/Libraries/Image/AssetRegistry").registerAsset({
  "__packager_asset": true,
  "httpServerLocation": "/assets/${relativePath}",
  "width": ${width},
  "height": ${height},
  "scales": [1],
  "hash": "${Date.now().toString(16)}",
  "name": "${name}",
  "type": "${type}"
});`;
}

/**
 * Module in the dependency graph
 */
interface GraphModule {
  path: string;
  code: string;
  transformedAst: any; // Metro-compatible: transformer returns AST, serializer generates code
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
 * Try to find platform-specific version of a file
 * e.g., Settings.js -> Settings.android.js or Settings.ios.js
 */
function tryPlatformSpecificFile(
  resolvedPath: string,
  platform: string,
  resolver: ResolvedConfig['resolver'],
): string | null {
  // Get the base path without extension
  const extMatch = resolvedPath.match(/\.[^.]+$/);
  if (!extMatch) return null;

  const ext = extMatch[0];
  const basePath = resolvedPath.slice(0, -ext.length);

  // Try platform-specific extension first
  const platformPath = `${basePath}.${platform}${ext}`;
  if (existsSync(platformPath)) {
    return platformPath;
  }

  // Try .native extension if preferNativePlatform
  if (resolver.preferNativePlatform) {
    const nativePath = `${basePath}.native${ext}`;
    if (existsSync(nativePath)) {
      return nativePath;
    }
  }

  return null;
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

    // Try without extension (if it's already a file, including assets)
    if (existsSync(basePath)) {
      return basePath;
    }

    // Try asset extensions (for image requires like require('./image.png'))
    // assetExts already include the dot (e.g., '.png', '.jpg')
    for (const ext of resolver.assetExts) {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      const assetPath = `${basePath}${normalizedExt}`;
      if (existsSync(assetPath)) {
        return assetPath;
      }
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

    // Check for platform-specific version of the resolved file
    // e.g., Settings.js -> Settings.android.js or Settings.ios.js
    if (platform !== 'web') {
      const platformResolved = tryPlatformSpecificFile(resolved, platform, resolver);
      if (platformResolved) {
        return platformResolved;
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
): Promise<{ ast: any } | null> {
  const { platform, dev } = config;

  // Skip Flow files and asset files
  if (filePath.endsWith('.flow.js') || filePath.endsWith('.flow')) {
    return null;
  }

  // JSON files: Export as module (no AST transformation needed)
  const isJSON = filePath.endsWith('.json');
  if (isJSON) {
    // Wrap JSON as CommonJS module - create simple AST
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync(`module.exports = ${code};`, {
      filename: filePath,
      sourceType: 'module',
    });
    return { ast };
  }

  // Use Babel for all transformations (Metro-compatible)
  // Note: Asset files are handled in processModule before reaching here
  return transformWithBabel(code, filePath, { dev, platform, root: config.root });
}

/**
 * Transform code using Babel with @react-native/babel-preset (Metro-compatible)
 * Uses the same preset that Metro uses for full compatibility
 * Reads babel.config.js from project root and merges with default settings (Metro-compatible)
 */
async function transformWithBabel(
  code: string,
  filePath: string,
  options: { dev: boolean; platform: string; root: string },
): Promise<{ ast: any }> {
  const babel = await import('@babel/core');
  const hermesParser = await import('hermes-parser');

  // Metro uses transformFromAstSync: parse AST first, then transform
  // Metro behavior: hermesParser option determines parser (Hermes or Babel)
  // We use Hermes parser by default (like Metro with hermesParser: true)
  // This handles Flow syntax including "import typeof" correctly
  const OLD_BABEL_ENV = process.env.BABEL_ENV;
  process.env.BABEL_ENV = options.dev ? 'development' : process.env.BABEL_ENV || 'production';

  try {
    // Metro-style babel config (matches reference/metro/packages/metro-babel-transformer/src/index.js)
    // Metro sets code: false to return AST only (serializer generates code)
    const babelConfig: any = {
      ast: true,
      babelrc: false, // Metro uses enableBabelRCLookup, we use false for consistency
      // Metro reads babel.config.js from cwd (projectRoot) - configFile defaults to true
      // If babel.config.js doesn't exist, Babel will use no presets (code won't be transformed)
      // This is expected - projects should have babel.config.js with @react-native/babel-preset
      caller: { bundler: 'bungae', name: 'bungae', platform: options.platform },
      cloneInputAst: false, // Metro sets this to avoid cloning overhead
      code: false, // Metro-compatible: return AST only, serializer generates code
      cwd: options.root, // Metro sets cwd to projectRoot - Babel auto-discovers babel.config.js from here
      filename: filePath,
      highlightCode: true,
      sourceType: 'module',
      // Metro doesn't set presets/plugins here - Babel reads babel.config.js automatically
      // We add our custom plugin for Platform.OS replacement
      plugins: [
        [
          require.resolve('babel-plugin-transform-define'),
          {
            'Platform.OS': options.platform, // Don't use JSON.stringify - babel-plugin-transform-define handles it
            'process.env.NODE_ENV': JSON.stringify(options.dev ? 'development' : 'production'),
          },
        ],
      ],
    };

    // Metro: Parse with Hermes parser (hermesParser: true) or Babel parser (hermesParser: false)
    // Select parser based on file extension (Metro-compatible):
    // - TypeScript files (.ts, .tsx) → Babel parser (TypeScript support)
    // - JavaScript/Flow files (.js, .jsx, .flow) → Hermes parser (Flow support including "import typeof")
    const fileExt = extname(filePath).toLowerCase();
    const useHermesParser = !fileExt.endsWith('.ts') && !fileExt.endsWith('.tsx');

    const sourceAst = useHermesParser
      ? hermesParser.parse(code, {
          babel: true,
          sourceType: babelConfig.sourceType,
        })
      : await babel.parseAsync(code, {
          filename: filePath,
          sourceType: babelConfig.sourceType,
          parserOpts: {
            // TypeScript files: use typescript plugin only (not flow)
            // JavaScript files: use jsx plugin only (flow handled by Hermes parser)
            plugins:
              fileExt.endsWith('.tsx') || fileExt.endsWith('.ts') ? ['jsx', 'typescript'] : ['jsx'],
          },
        });

    // Metro: Transform AST with Babel (Babel reads babel.config.js automatically from cwd)
    const transformResult = await babel.transformFromAstAsync(sourceAst, code, babelConfig);

    if (!transformResult?.ast) {
      // Type-only files may result in empty AST - create empty module AST
      // Create File node (Metro-compatible) with Program inside
      const emptyProgram = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'module' },
                property: { type: 'Identifier', name: 'exports' },
              },
              right: { type: 'ObjectExpression', properties: [] },
            },
          },
        ],
        directives: [],
        sourceType: 'module',
      };
      const emptyAst = {
        type: 'File',
        program: emptyProgram,
        comments: [],
        tokens: [],
      };
      return { ast: emptyAst };
    }

    // Metro-compatible: return AST only (no code generation)
    // Dependencies will be extracted from AST directly
    return { ast: transformResult.ast };
  } finally {
    if (OLD_BABEL_ENV) {
      process.env.BABEL_ENV = OLD_BABEL_ENV;
    }
  }
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

    // Handle asset files (images, etc.) - generate AssetRegistry module
    // assetExts already include the dot (e.g., '.png', '.jpg')
    const isAsset = config.resolver.assetExts.some((ext) => {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      return filePath.endsWith(normalizedExt);
    });
    if (isAsset) {
      // Resolve AssetRegistry dependency
      const assetRegistryPath = 'react-native/Libraries/Image/AssetRegistry';
      let resolvedAssetRegistry: string | null = null;
      try {
        resolvedAssetRegistry = require.resolve(assetRegistryPath, {
          paths: [config.root],
        });
      } catch {
        // AssetRegistry not found, skip asset processing
        console.warn(`[bungae] AssetRegistry not found, skipping asset: ${filePath}`);
        visited.add(filePath);
        processing.delete(filePath);
        return;
      }

      const assetCode = generateAssetModuleCode(filePath, config.root);
      // Parse asset code to AST (simple module.exports assignment)
      const babel = await import('@babel/core');
      const assetAst = await babel.parseAsync(assetCode, {
        filename: filePath,
        sourceType: 'module',
      });
      // Extract dependencies from asset AST (should include AssetRegistry)
      const assetDeps = await extractDependenciesFromAst(assetAst);
      const module: GraphModule = {
        path: filePath,
        code: assetCode,
        transformedAst: assetAst,
        dependencies: resolvedAssetRegistry ? [resolvedAssetRegistry] : [],
        originalDependencies: assetDeps.length > 0 ? assetDeps : [assetRegistryPath],
      };
      modules.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);
      processedCount++;
      onProgress?.(processedCount, totalCount);

      // Process AssetRegistry dependency if not already processed
      if (
        resolvedAssetRegistry &&
        !visited.has(resolvedAssetRegistry) &&
        !processing.has(resolvedAssetRegistry)
      ) {
        await processModule(resolvedAssetRegistry);
      }
      return;
    }

    // Read file
    const code = readFileSync(filePath, 'utf-8');

    // JSON files: No dependencies, just wrap as module
    const isJSON = filePath.endsWith('.json');
    if (isJSON) {
      const transformResult = await transformFile(filePath, code, config);
      const module: GraphModule = {
        path: filePath,
        code,
        transformedAst: transformResult?.ast || null,
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

    // Transform code (returns AST only, Metro-compatible)
    const transformResult = await transformFile(filePath, code, config);
    if (!transformResult) {
      // Flow file or other skipped file
      visited.add(filePath);
      processing.delete(filePath);
      processedCount++;
      onProgress?.(processedCount, totalCount);
      return;
    }

    // Metro-compatible: Extract dependencies from transformed AST only (no code generation)
    // Metro uses collectDependencies on transformed AST - type-only imports are handled by Babel preset
    // Babel may add new imports (e.g., react/jsx-runtime for JSX) which will be in the transformed AST
    const allDeps = await extractDependenciesFromAst(transformResult.ast);

    // Resolve dependencies (including asset files)
    const resolvedDependencies: string[] = [];
    const originalDependencies: string[] = [];

    for (const dep of allDeps) {
      if (!dep || !dep.trim()) continue;

      const resolved = await resolveModule(filePath, dep, config);
      if (resolved) {
        resolvedDependencies.push(resolved);
        originalDependencies.push(dep);
      } else if (config.dev) {
        console.warn(`[bungae] Failed to resolve "${dep}" from ${filePath}`);
      }
    }

    // Create module (store AST, serializer will generate code)
    const module: GraphModule = {
      path: filePath,
      code,
      transformedAst: transformResult.ast,
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

  // Note: ReactNativePrivateInitializeCore and InitializeCore should be automatically
  // included in the dependency graph when react-native is imported (via dependency traversal).
  // Metro does not manually add them - they are found through normal dependency resolution.
  // The serializer (baseJSBundle.ts) will find them in the graph and add to runBeforeMainModule.

  return modules;
}

/**
 * Convert graph modules to serializer modules
 */
async function graphToSerializerModules(graph: Map<string, GraphModule>): Promise<Module[]> {
  const generator = await import('@babel/generator');
  return Promise.all(
    Array.from(graph.values()).map(async (m) => {
      // Generate code from AST (Metro-compatible: serializer generates code from AST)
      // @babel/generator can handle File node directly (it uses program property)
      let code = '';
      if (m.transformedAst) {
        // If AST is File node, generator handles it directly
        // If AST is Program node, wrap it in File node for consistency
        const astToGenerate =
          m.transformedAst.type === 'File'
            ? m.transformedAst
            : { type: 'File', program: m.transformedAst, comments: [], tokens: [] };
        const generated = generator.default(astToGenerate, {
          comments: true,
          filename: m.path,
        });
        code = generated.code;
      } else {
        // Fallback for modules without AST (should not happen)
        code = m.code;
      }
      return {
        path: m.path,
        code,
        dependencies: m.dependencies,
        originalDependencies: m.originalDependencies,
        type: 'js/module' as const,
      };
    }),
  );
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

  console.log(`[bungae] Building dependency graph (Babel + Metro-compatible)...`);

  // Build dependency graph
  const startTime = Date.now();
  const graph = await buildGraph(entryPath, config, (processed, total) => {
    if (processed % 100 === 0 || processed === total) {
      process.stdout.write(`\r[bungae] Processing modules: ${processed}/${total}`);
    }
  });
  console.log(`\n[bungae] Graph built: ${graph.size} modules in ${Date.now() - startTime}ms`);

  // Convert to serializer modules
  const graphModules = await graphToSerializerModules(graph);

  // Read Bungae version from package.json
  let bungaeVersion = '0.0.1';
  try {
    const packageJsonPath = resolve(__dirname, '../../package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      bungaeVersion = packageJson.version || '0.0.1';
    }
  } catch (error) {
    // Fallback to default version if package.json cannot be read
  }

  // Merge extraVars with Bungae identifiers
  const extraVars = {
    ...config.serializer?.extraVars,
    __BUNGAE_BUNDLER__: true,
    __BUNGAE_VERSION__: bungaeVersion,
  };

  // Get prepended modules (prelude, metro-runtime, polyfills)
  const prependModules = getPrependedModules({
    dev,
    globalPrefix: '',
    polyfills: config.serializer?.polyfills || [],
    extraVars,
    requireCycleIgnorePatterns: [/(^|\/|\\)node_modules($|\/|\\)/],
    projectRoot: root,
  });

  // Create module ID factory
  const createModuleId = createModuleIdFactory();

  // Get modules to run before main module (Metro-compatible)
  // This uses the getModulesRunBeforeMainModule function from config
  let runBeforeMainModule: string[] = [];
  if (config.serializer?.getModulesRunBeforeMainModule) {
    try {
      runBeforeMainModule = config.serializer.getModulesRunBeforeMainModule(entryPath);
    } catch (error) {
      if (dev) {
        console.warn(`[bungae] Error calling getModulesRunBeforeMainModule: ${error}`);
      }
    }
  }

  // Serialize bundle
  const bundle = await baseJSBundle(entryPath, prependModules, graphModules, {
    createModuleId,
    getRunModuleStatement,
    dev,
    projectRoot: root,
    serverRoot: root,
    globalPrefix: '',
    runModule: true,
    runBeforeMainModule,
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
  // Use 0.0.0.0 to allow connections from Android emulator (10.0.2.2) and other devices
  const hostname = '0.0.0.0';

  console.log(
    `Starting Bungae dev server (Babel mode, Metro-compatible) on http://${hostname}:${port}`,
  );

  // Platform-aware cache: key is platform name
  const cachedBuilds = new Map<string, BuildResult>();
  const buildingPlatforms = new Map<string, Promise<BuildResult>>();

  // Track connected HMR clients and WebSocket connections
  const hmrClients = new Set<{ send: (msg: string) => void }>();
  const wsConnections = new Set<ServerWebSocket<HmrWsData>>();

  type HmrWsData = { url: string };
  type HmrClient = { send: (msg: string) => void };
  type HmrWs = ServerWebSocket<HmrWsData> & { _client?: HmrClient };

  const httpServer = Bun.serve<HmrWsData>({
    port,
    hostname,
    idleTimeout: 120, // 2 minutes timeout for slow builds
    async fetch(req, serverInstance) {
      const url = new URL(req.url);

      // Handle WebSocket upgrade for HMR (Metro protocol)
      // React Native connects to /hot for HMR
      if (url.pathname === '/hot' || url.pathname.startsWith('/hot?')) {
        const upgraded = serverInstance.upgrade(req, {
          data: { url: url.toString() } as HmrWsData,
        });
        if (upgraded) {
          return undefined; // Bun handles the upgrade
        }
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      if (url.pathname.endsWith('.bundle') || url.pathname.endsWith('.bundle.js')) {
        try {
          // Get platform from URL query parameter (React Native passes this)
          const requestPlatform = url.searchParams.get('platform') || platform;

          // Create platform-specific config
          const platformConfig: ResolvedConfig = {
            ...config,
            platform: requestPlatform as 'ios' | 'android' | 'web',
          };

          // Use cached build if available for this platform
          const cachedBuild = cachedBuilds.get(requestPlatform);
          if (cachedBuild) {
            console.log(`Serving cached ${requestPlatform} bundle...`);
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

          // If already building for this platform, wait for it
          const existingBuildPromise = buildingPlatforms.get(requestPlatform);
          if (existingBuildPromise) {
            console.log(`Waiting for ongoing ${requestPlatform} build...`);
            const build = await existingBuildPromise;
            cachedBuilds.set(requestPlatform, build);

            const bundleWithMapRef = build.map
              ? `${build.code}\n//# sourceMappingURL=${url.pathname}.map`
              : build.code;

            return new Response(bundleWithMapRef, {
              headers: {
                'Content-Type': 'application/javascript',
                'Cache-Control': 'no-cache',
              },
            });
          }

          // Start new build for this platform
          console.log(`Building ${requestPlatform} bundle (Babel mode, Metro-compatible)...`);
          const buildPromise = buildWithGraph(platformConfig);
          buildingPlatforms.set(requestPlatform, buildPromise);

          try {
            const build = await buildPromise;
            cachedBuilds.set(requestPlatform, build);
            buildingPlatforms.delete(requestPlatform);

            const bundleWithMapRef = build.map
              ? `${build.code}\n//# sourceMappingURL=${url.pathname}.map`
              : build.code;

            return new Response(bundleWithMapRef, {
              headers: {
                'Content-Type': 'application/javascript',
                'Cache-Control': 'no-cache',
              },
            });
          } catch (buildError) {
            buildingPlatforms.delete(requestPlatform);
            throw buildError;
          }
        } catch (error) {
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
        // Get platform from URL query parameter for sourcemap
        const mapPlatform = url.searchParams.get('platform') || platform;
        const cachedBuild = cachedBuilds.get(mapPlatform);
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
        wsConnections.add(ws);
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
        wsConnections.delete(ws);
        const client = (ws as HmrWs)._client;
        if (client) {
          hmrClients.delete(client);
        }
      },
    },
  });

  console.log(`✅ Dev server (Graph mode) running at http://${hostname}:${port}`);
  console.log(`   HMR endpoint: ws://${hostname}:${port}/hot`);

  // File watcher for auto-rebuild on file changes (dev mode only)
  let fileWatcher: FileWatcher | null = null;
  if (config.dev) {
    const invalidateCache = () => {
      // Clear cached builds to force rebuild on next request
      cachedBuilds.clear();
      buildingPlatforms.clear();
      console.log('[bungae] File changed, cache invalidated. Next bundle request will rebuild.');
    };

    fileWatcher = createFileWatcher({
      root: config.root,
      onFileChange: invalidateCache,
      debounceMs: 300,
    });
  }

  // Handle graceful shutdown on SIGINT (Ctrl+C) and SIGTERM
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    console.log(`\n[bungae] ${signal} received, shutting down dev server...`);

    try {
      // Close file watcher (if it was created)
      if (fileWatcher) {
        fileWatcher.close();
      }

      // Close all WebSocket connections
      for (const ws of wsConnections) {
        try {
          ws.close();
        } catch {
          // Ignore errors when closing
        }
      }
      wsConnections.clear();
      hmrClients.clear();

      // Stop the server
      await httpServer.stop();
      console.log('[bungae] Server stopped');

      process.exit(0);
    } catch (error) {
      console.error('[bungae] Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => {
      console.error('[bungae] Shutdown error:', err);
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => {
      console.error('[bungae] Shutdown error:', err);
      process.exit(1);
    });
  });

  // Keep the process alive - Bun.serve keeps the event loop running
  // The function doesn't need to return a pending promise
}

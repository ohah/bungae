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
import { dirname, join, resolve, relative, basename, extname, sep } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import type { ServerWebSocket } from 'bun';

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

  // Metro behavior: httpServerLocation always uses forward slashes (/) even on Windows
  // Convert Windows backslashes to forward slashes for URL compatibility
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');

  // Metro behavior: if relativePath is empty or '.', use empty string for httpServerLocation
  // This means assets in project root are served from /assets/
  const httpServerLocation =
    normalizedRelativePath && normalizedRelativePath !== '.'
      ? `/assets/${normalizedRelativePath}`
      : '/assets';

  // Generate Metro-compatible asset registration
  return `module.exports = require("react-native/Libraries/Image/AssetRegistry").registerAsset({
  "__packager_asset": true,
  "httpServerLocation": "${httpServerLocation}",
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
export interface AssetInfo {
  filePath: string;
  httpServerLocation: string;
  name: string;
  type: string;
  width: number;
  height: number;
  scales: number[]; // Metro scales array (e.g., [1] or [1, 2, 3])
}

export interface BuildResult {
  code: string;
  map?: string;
  assets?: AssetInfo[];
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
  entryPath?: string,
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
  return transformWithBabel(code, filePath, {
    dev,
    platform,
    root: config.root,
    entryPath,
  });
}

/**
 * Transform code using Babel with @react-native/babel-preset (Metro-compatible)
 * Uses the same preset that Metro uses for full compatibility
 * Reads babel.config.js from project root and merges with default settings (Metro-compatible)
 */
async function transformWithBabel(
  code: string,
  filePath: string,
  options: { dev: boolean; platform: string; root: string; entryPath?: string },
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
    // Metro behavior: Babel auto-discovers babel.config.js from cwd (projectRoot)
    // Metro does NOT explicitly set configFile path - it relies on Babel's auto-discovery
    // Metro behavior: enableBabelRCLookup controls babelrc/configFile
    // When enableBabelRCLookup is true, Metro sets babelrc: true and configFile: true (default)
    // When enableBabelRCLookup is false, Metro sets babelrc: false and configFile: false
    // React Native projects typically have enableBabelRCLookup: true (default)
    // So we should use babelrc: true and configFile: true to match Metro's default behavior
    const babelConfig: any = {
      ast: true,
      // Metro default: enableBabelRCLookup is true, so babelrc: true and configFile: true
      // This allows Babel to read babel.config.js from project root
      babelrc: true, // Metro default: enableBabelRCLookup is true
      configFile: true, // Metro default: Babel reads babel.config.js from cwd
      // If babel.config.js doesn't exist, Babel will use no presets (code won't be transformed)
      // This is expected - projects should have babel.config.js with @react-native/babel-preset
      caller: {
        bundler: 'metro',
        name: 'metro',
        platform: options.platform,
        // Metro includes these additional caller options for @react-native/babel-preset
        isDev: options.dev,
        isServer: false,
        // Engine can be 'hermes' or 'jsc' - default to 'hermes' for React Native
        engine: 'hermes',
      },
      cloneInputAst: false, // Metro sets this to avoid cloning overhead
      code: false, // Metro-compatible: return AST only, serializer generates code
      cwd: options.root, // Metro sets cwd to projectRoot - Babel auto-discovers babel.config.js from here
      filename: filePath,
      highlightCode: true,
      sourceType: 'module',
      // Metro doesn't set presets/plugins here - Babel reads babel.config.js automatically
      // We add our custom plugin for Platform.OS replacement
      // Also override object-rest-spread plugin to use loose mode (Object.assign) for Metro compatibility
      plugins: [
        [
          require.resolve('babel-plugin-transform-define'),
          {
            'Platform.OS': options.platform, // Don't use JSON.stringify - babel-plugin-transform-define handles it
            'process.env.NODE_ENV': JSON.stringify(options.dev ? 'development' : 'production'),
          },
        ],
        // Override @babel/plugin-transform-object-rest-spread to use loose mode
        // This makes it use Object.assign instead of helper functions, matching Metro's behavior
        // Adding this plugin here will override the same plugin from @react-native/babel-preset
        [
          require.resolve('@babel/plugin-transform-object-rest-spread'),
          {
            loose: true,
            useBuiltIns: true,
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
    // Debug: Check if Babel loaded babel.config.js (in dev mode for important files)
    // Check for: entry file, JSX/TSX files, or react-native files
    const isEntryFile = options.entryPath && filePath === options.entryPath;
    const isJSXFile = fileExt.endsWith('.jsx') || fileExt.endsWith('.tsx');
    const isReactNativeFile = filePath.includes('node_modules/react-native');
    const shouldCheckPreset = options.dev && (isEntryFile || isJSXFile || isReactNativeFile);

    if (shouldCheckPreset) {
      try {
        // Use loadOptionsAsync to check if babel.config.js is loaded
        // Pass only config-related options, not transform options
        // Note: loadOptionsAsync exists in Babel 7 but may not be in type definitions
        const loadedOptions = await (babel.default as any).loadOptionsAsync({
          cwd: options.root,
          filename: filePath,
          caller: babelConfig.caller,
          babelrc: true, // Metro default: enableBabelRCLookup is true
          configFile: true, // Metro default: Babel reads babel.config.js
        });
        if (loadedOptions?.presets && loadedOptions.presets.length > 0) {
          const presetNames = loadedOptions.presets.map((p: any) => {
            if (Array.isArray(p)) return p[0];
            return typeof p === 'string' ? p : 'unknown';
          });
          const fileType = isEntryFile ? 'entry' : isJSXFile ? 'JSX' : 'react-native';
          console.log(
            `[bungae] Babel loaded ${loadedOptions.presets.length} preset(s) for ${fileType} file ${filePath}: ${presetNames.join(', ')}`,
          );
        } else {
          const fileType = isEntryFile ? 'entry' : isJSXFile ? 'JSX' : 'react-native';
          console.warn(
            `[bungae] WARNING: Babel did not load any presets for ${fileType} file ${filePath}. JSX and event handlers may not work correctly.`,
          );
          console.warn(`[bungae] cwd: ${options.root}, filename: ${filePath}`);
          console.warn(
            `[bungae] Please ensure babel.config.js exists and includes @react-native/babel-preset`,
          );
        }
      } catch (error) {
        console.warn(`[bungae] Failed to load Babel options for ${filePath}:`, error);
      }
    }

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
          paths: [config.root, ...config.resolver.nodeModulesPaths],
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
      const transformResult = await transformFile(filePath, code, config, entryPath);
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
    const transformResult = await transformFile(filePath, code, config, entryPath);
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
 * Reorder graph modules in DFS order (Metro-compatible)
 * Metro uses reorderGraph to ensure modules are in DFS traversal order
 * This ensures consistent module ID assignment matching Metro's behavior
 *
 * Metro uses post-order DFS: dependencies are visited first, then parent module
 * This means dependencies get lower module IDs than their parents
 */
function reorderGraph(graph: Map<string, GraphModule>, entryPath: string): GraphModule[] {
  const ordered: GraphModule[] = [];
  const visited = new Set<string>();

  function visitModule(modulePath: string): void {
    if (visited.has(modulePath)) {
      return;
    }

    const module = graph.get(modulePath);
    if (!module) {
      return;
    }

    visited.add(modulePath);

    // Visit dependencies first (post-order DFS)
    // Metro processes dependencies in the order they appear in the dependencies array
    // Dependencies are added to the ordered list before their parent module
    for (const dep of module.dependencies) {
      if (graph.has(dep) && !visited.has(dep)) {
        visitModule(dep);
      }
    }

    // Add module to ordered list after visiting all dependencies (post-order)
    // This ensures dependencies get lower module IDs than their parents
    ordered.push(module);
  }

  // Start DFS from entry point
  if (graph.has(entryPath)) {
    visitModule(entryPath);
  }

  // Handle any remaining modules that weren't reachable from entry
  // (shouldn't happen in normal cases, but for safety)
  for (const [path] of graph.entries()) {
    if (!visited.has(path)) {
      visitModule(path);
    }
  }

  return ordered;
}

/**
 * Convert graph modules to serializer modules
 * Now accepts ordered modules array instead of Map to ensure consistent ordering
 * In production builds, excludes dev-only modules like openURLInBrowser (Metro-compatible)
 */
async function graphToSerializerModules(
  orderedModules: GraphModule[],
  config: ResolvedConfig,
): Promise<Module[]> {
  const generator = await import('@babel/generator');

  // In production builds, exclude dev-only modules (Metro-compatible)
  // Metro excludes openURLInBrowser and other dev tools in production builds
  const filteredModules = config.dev
    ? orderedModules
    : orderedModules.filter((m) => {
        // Exclude React Native dev tools modules in production
        // These modules are only used in development mode
        const isDevTool =
          m.path.includes('openURLInBrowser') ||
          m.path.includes('Devtools/openURLInBrowser') ||
          m.path.includes('Core/Devtools');
        if (isDevTool) {
          console.log(
            `[bungae] Excluding dev-only module from production build: ${m.path} (Metro-compatible)`,
          );
          return false;
        }
        return true;
      });

  return Promise.all(
    filteredModules.map(async (m) => {
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

  // Get modules to run before main module (Metro-compatible)
  // This needs to be done before building graph to ensure these modules are included
  // Pass nodeModulesPaths for monorepo support (Metro-compatible)
  let runBeforeMainModule: string[] = [];
  if (config.serializer?.getModulesRunBeforeMainModule) {
    try {
      runBeforeMainModule = config.serializer.getModulesRunBeforeMainModule(entryPath, {
        projectRoot: root,
        nodeModulesPaths: config.resolver.nodeModulesPaths,
      });
      if (dev && runBeforeMainModule.length > 0) {
        console.log(`[bungae] Modules to run before main: ${runBeforeMainModule.join(', ')}`);
      }
    } catch (error) {
      if (dev) {
        console.warn(`[bungae] Error calling getModulesRunBeforeMainModule: ${error}`);
      }
    }
  }

  // Build dependency graph
  const startTime = Date.now();
  const graph = await buildGraph(entryPath, config, (processed, total) => {
    if (processed % 100 === 0 || processed === total) {
      process.stdout.write(`\r[bungae] Processing modules: ${processed}/${total}`);
    }
  });
  console.log(`\n[bungae] Graph built: ${graph.size} modules in ${Date.now() - startTime}ms`);

  // Metro behavior: Metro assumes runBeforeMainModule modules are already in the dependency graph.
  // Check if InitializeCore is in the graph and log debug info if not found.
  if (dev && runBeforeMainModule.length > 0) {
    for (const modulePath of runBeforeMainModule) {
      const found = graph.has(modulePath);
      if (!found) {
        // Check if any module in graph matches InitializeCore by path segments
        const matchingModules = Array.from(graph.keys()).filter((path) =>
          path.includes('InitializeCore'),
        );
        console.warn(
          `[bungae] InitializeCore not found in dependency graph. Expected: ${modulePath}`,
        );
        if (matchingModules.length > 0) {
          console.warn(`[bungae] Found similar modules in graph: ${matchingModules.join(', ')}`);
        } else {
          console.warn(
            `[bungae] No InitializeCore-related modules found in dependency graph. Graph size: ${graph.size}`,
          );
          // Debug: Check if react-native is in the graph
          const reactNativeModules = Array.from(graph.keys()).filter((path) =>
            path.includes('react-native'),
          );
          if (reactNativeModules.length > 0) {
            console.warn(
              `[bungae] Found react-native modules in graph (${reactNativeModules.length}): ${reactNativeModules.slice(0, 5).join(', ')}...`,
            );
          } else {
            console.warn(`[bungae] No react-native modules found in dependency graph!`);
          }
        }
      }
    }
  }

  // Reorder graph modules in DFS order (Metro-compatible)
  // This ensures module ID assignment matches Metro's behavior
  const orderedGraphModules = reorderGraph(graph, entryPath);
  if (dev) {
    console.log(
      `[bungae] Reordered ${orderedGraphModules.length} modules in DFS order (Metro-compatible)`,
    );
  }

  // Convert to serializer modules (now using ordered array)
  // Pass config to filter out dev-only modules in production builds
  const graphModules = await graphToSerializerModules(orderedGraphModules, config);

  // Read Bungae version from package.json
  let bungaeVersion = '0.0.1';
  try {
    const packageJsonPath = resolve(__dirname, '../../package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      bungaeVersion = packageJson.version || '0.0.1';
    }
  } catch {
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

  // Extract asset files from bundle modules (only assets actually included in bundle)
  // Metro only copies assets that are actually required/imported in the bundle
  // CRITICAL: We need to analyze the actual bundle code to see which modules are actually required
  // Metro does this by checking which modules are actually __r() called in the bundle code

  // Create reverse mapping: moduleId -> module path from graphModules
  const moduleIdToPath = new Map<number | string, string>();
  for (const module of graphModules) {
    const moduleId = createModuleId(module.path);
    moduleIdToPath.set(moduleId, module.path);
  }

  // Analyze bundle code to find which modules are actually required
  // Metro includes modules in bundle.modules, but we need to check if they're actually used
  // Look for __r(moduleId) calls in the bundle code to see which modules are actually required
  const requiredModuleIds = new Set<number | string>();

  // Check pre code for requires
  if (bundle.pre) {
    const preRequires = bundle.pre.match(/__r\((\d+)\)/g);
    if (preRequires) {
      for (const req of preRequires) {
        const match = req.match(/__r\((\d+)\)/);
        if (match) {
          requiredModuleIds.add(Number(match[1]));
        }
      }
    }
  }

  // Check post code for requires
  if (bundle.post) {
    const postRequires = bundle.post.match(/__r\((\d+)\)/g);
    if (postRequires) {
      for (const req of postRequires) {
        const match = req.match(/__r\((\d+)\)/);
        if (match) {
          requiredModuleIds.add(Number(match[1]));
        }
      }
    }
  }

  // Analyze the entire bundle code to find which modules are actually required
  // Metro includes all modules that are reachable from entry point, but we need to check
  // which ones are actually __r() called in the bundle code
  const allBundleCode =
    bundle.pre + '\n' + bundle.modules.map(([, code]) => code).join('\n') + '\n' + bundle.post;

  // Find all __r() calls in the bundle code
  // Use a more robust regex that handles both number and string IDs
  const allRequires = allBundleCode.match(/__r\(([^)]+)\)/g);
  if (allRequires) {
    for (const req of allRequires) {
      const match = req.match(/__r\(([^)]+)\)/);
      if (match && match[1]) {
        const moduleIdStr = match[1].trim();
        // Try to parse as number first, then as string
        const moduleId = /^\d+$/.test(moduleIdStr) ? Number(moduleIdStr) : moduleIdStr;
        requiredModuleIds.add(moduleId);
      }
    }
  }

  // CRITICAL: Metro only includes assets that are actually __r() called in the bundle code
  // Even if a module is defined with __d(), it's not included unless it's actually required
  // So we ONLY include modules that are in requiredModuleIds (from __r() calls)

  // Debug: Check which asset modules are in requiredModuleIds
  const _requiredAssetIds = Array.from(requiredModuleIds).filter((id) => {
    const path = moduleIdToPath.get(id);
    return (
      path &&
      config.resolver.assetExts.some((ext) => {
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        return path.endsWith(normalizedExt);
      })
    );
  });

  // Also check which asset modules are in bundle.modules but NOT in requiredModuleIds
  const allAssetIds = bundle.modules
    .map(([id]) => id)
    .filter((id) => {
      const path = moduleIdToPath.get(id);
      return (
        path &&
        config.resolver.assetExts.some((ext) => {
          const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
          return path.endsWith(normalizedExt);
        })
      );
    });
  const _unusedAssetIds = allAssetIds.filter((id) => !requiredModuleIds.has(id));

  // CRITICAL FIX: Only include modules that are actually required in the bundle code
  // Metro only copies assets that are actually __r() called, not just defined with __d()
  // However, assets are not directly __r() called - they are required by other modules
  // We need to follow the dependency graph from __r() called modules to find assets

  // Create reverse mapping: path -> moduleId (for dependency lookup)
  const pathToModuleId = new Map<string, number | string>();
  for (const [moduleId, path] of moduleIdToPath.entries()) {
    pathToModuleId.set(path, moduleId);
  }

  // Log debug info
  if (requiredModuleIds.size === 0) {
    console.error(
      `[bungae] ERROR: No modules found in __r() calls! Bundle code analysis may have failed.`,
    );
    console.error(`[bungae] ERROR: This means NO assets should be copied (Metro behavior)`);
  }

  // Only include assets that are actually used
  // Start with __r() called modules and recursively add their dependencies
  // This follows the dependency graph from __r() called modules to find all used modules including assets
  // CRITICAL: We only include modules that are actually require()'d, not just referenced in dependencyMap
  const bundledModulePaths = new Set<string>();
  const modulesToInclude = new Set(requiredModuleIds);
  const processedModuleIds = new Set<number | string>();

  // Recursively add dependencies of __r() called modules
  while (modulesToInclude.size > 0) {
    const currentModuleId = Array.from(modulesToInclude)[0];
    if (currentModuleId === undefined) break;
    modulesToInclude.delete(currentModuleId);

    if (processedModuleIds.has(currentModuleId)) {
      continue;
    }
    processedModuleIds.add(currentModuleId);

    const modulePath = moduleIdToPath.get(currentModuleId);
    if (modulePath) {
      bundledModulePaths.add(modulePath);

      // Find this module's code and get its dependencies from dependencyMap
      const moduleCode = bundle.modules.find(([id]) => id === currentModuleId)?.[1];
      if (moduleCode) {
        // Try multiple regex patterns to match __d() format
        // Format: __d(function..., moduleId, [deps...])
        // The function can be very long, so we need a more flexible regex
        let depMapMatch = moduleCode.match(/__d\([^,]+,\s*(\d+),\s*\[([^\]]+)\]/);
        if (!depMapMatch) {
          // Try without spaces around moduleId
          depMapMatch = moduleCode.match(/__d\([^,]+,(\d+),\[([^\]]+)\]/);
        }
        if (!depMapMatch) {
          // Try matching the end of __d() call: },moduleId,[deps])
          depMapMatch = moduleCode.match(/},\s*(\d+),\s*\[([^\]]+)\]/);
        }
        if (depMapMatch) {
          const moduleIdFromMatch = Number(depMapMatch[1]);
          // Verify this matches the current module ID
          if (
            moduleIdFromMatch !== currentModuleId &&
            String(moduleIdFromMatch) !== String(currentModuleId)
          ) {
            // Module ID mismatch, skip
            depMapMatch = null;
          }
        }
        if (depMapMatch) {
          const depsStr = depMapMatch[2];
          if (depsStr) {
            const deps = depsStr
              .split(',')
              .map((d) => d.trim())
              .filter((d) => d && d !== '');
            // Find which dependencyMap indices are actually used in require() calls
            // Metro only includes dependencies that are actually require()'d
            // Pattern: require(dependencyMap[index])
            // CRITICAL: In release builds, exclude requires inside __DEV__ conditional blocks
            const usedDepIndices = new Set<number>();
            const requireMatches = moduleCode.match(/require\(dependencyMap\[(\d+)\]\)/g);
            if (requireMatches) {
              for (const match of requireMatches) {
                const indexMatch = match.match(/require\(dependencyMap\[(\d+)\]\)/);
                if (indexMatch) {
                  const depIndex = Number(indexMatch[1]);

                  // In release builds, exclude requires inside __DEV__ conditional blocks
                  // Metro replaces __DEV__ with false in release builds, so conditional blocks are removed
                  // But if __DEV__ is still in the code, we need to exclude requires inside those blocks
                  if (!config.dev) {
                    // Find the position of this require in the code
                    let requirePos = -1;
                    let searchStart = 0;
                    while (true) {
                      const pos = moduleCode.indexOf(match, searchStart);
                      if (pos === -1) break;
                      // Check if this is the same require we're looking for (by checking the index)
                      const testMatch = moduleCode
                        .substring(pos)
                        .match(/require\(dependencyMap\[(\d+)\]\)/);
                      if (testMatch && Number(testMatch[1]) === depIndex) {
                        requirePos = pos;
                        break;
                      }
                      searchStart = pos + 1;
                    }

                    if (requirePos >= 0) {
                      // Look backwards to find if this require is inside a __DEV__ conditional
                      const beforeRequire = moduleCode.substring(
                        Math.max(0, requirePos - 2000),
                        requirePos,
                      );

                      // Find the last occurrence of __DEV__ conditional patterns before this require
                      // Patterns: if (__DEV__), if (process.env.NODE_ENV === 'development'), __DEV__ &&, __DEV__ ?
                      // Also check for transformed patterns: if (false), if ('production' === 'development'), false &&
                      const devConditionPatterns = [
                        { pattern: /if\s*\(\s*__DEV__\s*\)/g, needsBrace: true },
                        {
                          pattern:
                            /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*['"]development['"]\s*\)/g,
                          needsBrace: true,
                        },
                        { pattern: /__DEV__\s*&&/g, needsBrace: false },
                        { pattern: /__DEV__\s*\?/g, needsBrace: false },
                        // Transformed patterns (after Babel transformation in release builds)
                        { pattern: /if\s*\(\s*false\s*\)/g, needsBrace: true },
                        {
                          pattern: /if\s*\(\s*['"]production['"]\s*===\s*['"]development['"]\s*\)/g,
                          needsBrace: true,
                        },
                        {
                          pattern: /if\s*\(\s*['"]development['"]\s*!==\s*['"]production['"]\s*\)/g,
                          needsBrace: true,
                        },
                        { pattern: /false\s*&&/g, needsBrace: false },
                      ];

                      let isInDevBlock = false;
                      for (const { pattern, needsBrace } of devConditionPatterns) {
                        const matches = [...beforeRequire.matchAll(pattern)];
                        if (matches.length > 0) {
                          // Find the last match
                          const lastMatch = matches[matches.length - 1];
                          if (lastMatch && lastMatch.index !== undefined) {
                            const matchPos = lastMatch.index;
                            const codeAfterMatch = beforeRequire.substring(matchPos);

                            if (needsBrace) {
                              // Count braces to see if we're still inside the conditional block
                              let braceCount = 0;
                              let inString = false;
                              let stringChar = '';

                              for (let i = 0; i < codeAfterMatch.length; i++) {
                                const char = codeAfterMatch[i];
                                if (!inString && (char === '"' || char === "'" || char === '`')) {
                                  inString = true;
                                  stringChar = char;
                                } else if (
                                  inString &&
                                  char === stringChar &&
                                  (i === 0 || codeAfterMatch[i - 1] !== '\\')
                                ) {
                                  inString = false;
                                } else if (!inString) {
                                  if (char === '{') braceCount++;
                                  else if (char === '}') braceCount--;
                                }
                              }

                              // If we have unclosed braces, we're still inside the conditional block
                              if (braceCount > 0) {
                                isInDevBlock = true;
                                break;
                              }
                            } else {
                              // For && and ? operators, check if require is on the same "line" (before next ; or })
                              const matchLength = lastMatch[0]?.length || 0;
                              const codeAfterMatchToRequire = moduleCode.substring(
                                matchPos + matchLength,
                                requirePos,
                              );
                              // Check if require is part of the expression (no semicolon, closing brace, or newline before it)
                              // Patterns: __DEV__ &&, __DEV__ ?, false && (transformed __DEV__ &&)
                              const isDevPattern =
                                lastMatch[0].includes('__DEV__') || lastMatch[0].includes('false');
                              if (isDevPattern && !codeAfterMatchToRequire.match(/[;}\n]/)) {
                                isInDevBlock = true;
                                break;
                              }
                            }
                          }
                        }
                      }

                      if (isInDevBlock) {
                        console.log(
                          `[bungae] Excluding require(dependencyMap[${depIndex}]) in module ${currentModuleId} - inside __DEV__ conditional (release build)`,
                        );
                        continue;
                      }
                    }
                  }

                  usedDepIndices.add(depIndex);
                }
              }
            }

            // Add dependencies that are actually used (referenced in dependencyMap)
            // CRITICAL: Only add dependencies that are actually used in the code
            // For assets, we need to be extra careful - Metro only includes assets that are actually require()'d
            for (const depIndex of usedDepIndices) {
              if (depIndex < deps.length) {
                const depModuleIdStr = deps[depIndex];
                if (depModuleIdStr) {
                  const depModuleId = /^\d+$/.test(depModuleIdStr)
                    ? Number(depModuleIdStr)
                    : depModuleIdStr;
                  const depPath = moduleIdToPath.get(depModuleId);

                  if (!depPath) continue;

                  // Check if this is an asset
                  const isAsset = config.resolver.assetExts.some((ext) => {
                    const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
                    return depPath.endsWith(normalizedExt);
                  });

                  // CRITICAL FIX: For assets, we need to verify that:
                  // 1. The dependencyMap[depIndex] is actually used in require() calls
                  // 2. The depModuleId at dependencyMap[depIndex] is actually an asset module ID
                  // 3. The require() call is for the asset (not just any dependencyMap[index])
                  // NOTE: usedDepIndices already contains only indices that are require()'d,
                  // so if depIndex is in usedDepIndices, it means require(dependencyMap[depIndex]) is called
                  if (isAsset) {
                    // Since depIndex is in usedDepIndices, it means require(dependencyMap[depIndex]) is called
                    // This is the asset that is actually required
                    if (!processedModuleIds.has(depModuleId)) {
                      modulesToInclude.add(depModuleId);
                    }
                  } else {
                    // For non-assets, add if not already processed
                    if (!processedModuleIds.has(depModuleId)) {
                      modulesToInclude.add(depModuleId);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Debug: Log detailed asset detection
  const _allAssetPaths = Array.from(graph.keys()).filter((path) =>
    config.resolver.assetExts.some((ext) => {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      return path.endsWith(normalizedExt);
    }),
  );
  const _bundledAssetPaths = Array.from(bundledModulePaths).filter((path) =>
    config.resolver.assetExts.some((ext) => {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      return path.endsWith(normalizedExt);
    }),
  );

  // Metro behavior: Extract assets from modules that are actually included in bundle
  // Metro's getAssets function receives graph.dependencies (all modules in bundle)
  // and filters them with processModuleFilter, then extracts assets
  // We use bundledModulePaths which contains only modules that are actually executed
  // (reachable from __r() called modules via require() calls)
  const assets: AssetInfo[] = [];
  for (const modulePath of bundledModulePaths) {
    // Check if this is an asset file
    const isAsset = config.resolver.assetExts.some((ext) => {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      return modulePath.endsWith(normalizedExt);
    });

    if (isAsset) {
      // Get original module from graph to access code for scales extraction
      const graphModule = graph.get(modulePath);
      const { width, height } = getImageSize(modulePath);
      const name = basename(modulePath, extname(modulePath));
      const type = extname(modulePath).slice(1);
      const relativePath = relative(root, dirname(modulePath));
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');
      const httpServerLocation =
        normalizedRelativePath && normalizedRelativePath !== '.'
          ? `/assets/${normalizedRelativePath}`
          : '/assets';

      // Extract scales from asset code (default to [1] if not found)
      // Metro uses scales array to determine which drawable folders to create
      let scales = [1]; // Default scale
      try {
        // Try to extract scales from the module code
        const moduleCode = graphModule?.code;
        if (moduleCode && typeof moduleCode === 'string' && moduleCode.includes('scales:')) {
          const scalesMatch = moduleCode.match(/scales:\s*\[([^\]]+)\]/);
          if (scalesMatch) {
            const scalesStr = scalesMatch[1];
            if (scalesStr) {
              const extractedScales = scalesStr
                .split(',')
                .map((s) => parseFloat(s.trim()))
                .filter((s) => !isNaN(s));
              if (extractedScales.length > 0) {
                scales = extractedScales;
              }
            }
          }
        }
      } catch {
        // If extraction fails, use default [1]
      }

      assets.push({
        filePath: modulePath,
        httpServerLocation,
        name,
        type,
        width,
        height,
        scales,
      });
    }
  }

  return { code, map, assets };
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

      // Handle /open-url endpoint (Metro-compatible)
      // This endpoint is used by openURLInBrowser to open URLs in the default browser
      // Metro format: POST /open-url with body: { url: "https://..." }
      if (url.pathname === '/open-url') {
        if (req.method === 'POST') {
          try {
            const body = (await req.json()) as { url?: string };
            const targetUrl = body?.url;
            if (targetUrl && typeof targetUrl === 'string') {
              // Open URL in default browser
              // Use Bun's built-in spawn for cross-platform support
              const platform = process.platform;
              let command: string;
              let args: string[];

              if (platform === 'win32') {
                // Windows: use start command
                command = 'cmd';
                args = ['/c', 'start', '', targetUrl];
              } else if (platform === 'darwin') {
                // macOS: use open command
                command = 'open';
                args = [targetUrl];
              } else {
                // Linux and others: use xdg-open
                command = 'xdg-open';
                args = [targetUrl];
              }

              // Spawn process in background (detached) to avoid blocking
              // Bun.spawn takes command and args separately
              const proc = Bun.spawn([command, ...args], {
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
              });
              // Don't wait for the process to complete
              proc.unref();

              console.log(`[bungae] Opening URL in browser: ${targetUrl}`);
              return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' },
              });
            } else {
              return new Response(JSON.stringify({ error: 'Invalid URL' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          } catch (error) {
            console.error('[bungae] Error opening URL:', error);
            return new Response(JSON.stringify({ error: 'Failed to open URL' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } else {
          return new Response('Method Not Allowed', { status: 405 });
        }
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

      // Handle asset requests (Metro-compatible)
      // Metro serves assets over HTTP in dev mode (not copied to filesystem)
      // Metro URL format: httpServerLocation + '/' + name + '@' + scale + '.' + type
      // Metro generates: /assets/../../node_modules/.../react-light.png
      // HTTP clients (OkHttp) normalize relative paths (../), so requests may come as:
      // - /assets/../../node_modules/... (original)
      // - /node_modules/... (normalized by HTTP client)
      // We need to handle both cases
      const isAssetRequest =
        url.pathname.startsWith('/assets/') || url.pathname.startsWith('/node_modules/');
      if (isAssetRequest) {
        try {
          // Handle both /assets/... and /node_modules/... paths
          let assetRelativePath: string;
          if (url.pathname.startsWith('/assets/')) {
            // Remove /assets/ prefix
            assetRelativePath = url.pathname.slice('/assets/'.length);
            // Metro behavior: httpServerLocation can contain relative paths like "../../node_modules/..."
            // These are relative to project root. We need to resolve them correctly.
            // Example: "../../node_modules/.../assets/react-light.png"
            // Use path.resolve to properly handle ../ segments
            // First, normalize the path by removing leading ../ and resolving
            const pathSegments = assetRelativePath.split('/');
            let resolvedSegments: string[] = [];
            for (const segment of pathSegments) {
              if (segment === '..') {
                if (resolvedSegments.length > 0) {
                  resolvedSegments.pop();
                }
              } else if (segment !== '.' && segment !== '') {
                resolvedSegments.push(segment);
              }
            }
            assetRelativePath = resolvedSegments.join('/');
          } else if (url.pathname.startsWith('/node_modules/')) {
            // HTTP client normalized /assets/../../node_modules/... to /node_modules/...
            // This is already an absolute path from project root
            assetRelativePath = url.pathname.slice('/node_modules/'.length);
            // Prepend node_modules/ to make it relative to project root
            assetRelativePath = `node_modules/${assetRelativePath}`;
          } else {
            return new Response('Bad Request', { status: 400 });
          }

          // Remove scale suffix if present (e.g., react-light@2x.png -> react-light.png)
          // Metro adds @scale suffix for scaled assets, but we need the original file
          assetRelativePath = assetRelativePath.replace(/@\d+x\./, '.');

          // Normalize path separators: convert any backslashes to forward slashes (Windows compatibility)
          assetRelativePath = assetRelativePath.replace(/\\/g, '/');

          // Convert forward slashes to platform-specific separators for file system access
          const normalizedPath = assetRelativePath.replace(/\//g, sep);

          // Try resolving from project root first
          let resolvedAssetPath = resolve(config.root, normalizedPath);

          // If not found, try from monorepo node_modules paths
          if (!existsSync(resolvedAssetPath)) {
            for (const nodeModulesPath of config.resolver.nodeModulesPaths) {
              const monorepoPath = resolve(config.root, nodeModulesPath);
              // Try resolving from monorepo root
              const alternativePath = resolve(monorepoPath, '..', normalizedPath);
              if (existsSync(alternativePath)) {
                resolvedAssetPath = alternativePath;
                break;
              }
            }
          }

          // Use resolved path (rename to avoid variable shadowing)
          const finalAssetPath = resolvedAssetPath;

          // Security: Ensure the resolved path is within allowed directories
          const normalizedAssetPath = resolve(finalAssetPath);
          const normalizedRoot = resolve(config.root);

          // Check if path is within project root
          let isAllowed = normalizedAssetPath.startsWith(normalizedRoot);

          // Also check monorepo node_modules paths
          if (!isAllowed) {
            isAllowed = config.resolver.nodeModulesPaths.some((p) => {
              const monorepoNodeModules = resolve(config.root, p);
              return normalizedAssetPath.startsWith(monorepoNodeModules);
            });
          }

          if (!isAllowed) {
            console.warn(`[bungae] Asset path outside allowed directories: ${normalizedAssetPath}`);
            return new Response('Forbidden', { status: 403 });
          }

          // Check if file exists
          if (!existsSync(normalizedAssetPath)) {
            console.warn(
              `[bungae] Asset not found: ${normalizedAssetPath} (requested: ${url.pathname})`,
            );
            return new Response('Not Found', { status: 404 });
          }

          // Read and serve the asset file
          const file = Bun.file(finalAssetPath);
          const ext = extname(normalizedAssetPath).toLowerCase();

          // Determine content type based on extension
          const contentTypeMap: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.json': 'application/json',
          };

          const contentType = contentTypeMap[ext] || 'application/octet-stream';

          return new Response(file, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000', // Cache assets for 1 year
            },
          });
        } catch (error) {
          console.error(`[bungae] Error serving asset ${url.pathname}:`, error);
          return new Response('Internal Server Error', { status: 500 });
        }
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

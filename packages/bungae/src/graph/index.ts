/**
 * Dependency Graph - Builds dependency graph from entry point
 */

import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, dirname, join } from 'path';

import { createPlatformResolverPlugin } from '../resolver/platform-plugin';
import { getPrependedModules } from '../serializer';
import type { Module as SerializerModule } from '../serializer/types';
import { extractDependencies } from '../transformer/utils';
import type { GraphBuildOptions, GraphBuildResult, GraphModule } from './types';

/**
 * Resolve module path with platform-specific extensions
 */
async function resolveModule(
  fromPath: string,
  moduleSpecifier: string,
  options: GraphBuildOptions,
): Promise<string | null> {
  const fromDir = dirname(fromPath);
  const { platform, resolver } = options;

  // Handle relative paths
  if (moduleSpecifier.startsWith('.')) {
    const basePath = resolve(fromDir, moduleSpecifier);

    // Build extension priority list
    const extensions: string[] = [];

    // 1. Platform-specific extensions
    if (platform !== 'web') {
      for (const ext of resolver.sourceExts) {
        extensions.push(`.${platform}${ext}`);
      }
    }

    // 2. Native extensions (if preferNativePlatform)
    if (resolver.preferNativePlatform && platform !== 'web') {
      for (const ext of resolver.sourceExts) {
        extensions.push(`.native${ext}`);
      }
    }

    // 3. Default extensions
    for (const ext of resolver.sourceExts) {
      extensions.push(ext);
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

    // Try with .js extension explicitly (some files might not have extension in path)
    if (existsSync(`${basePath}.js`)) {
      return `${basePath}.js`;
    }

    return null;
  }

  // Handle node_modules - use Bun's built-in resolution via require.resolve
  try {
    // Use require.resolve to leverage Node.js/Bun's module resolution
    // This handles package.json exports, main, module fields, etc.
    let resolved = require.resolve(moduleSpecifier, {
      paths: [
        fromDir,
        options.projectRoot,
        resolve(options.projectRoot, 'node_modules'),
        ...resolver.nodeModulesPaths.map((p) => resolve(options.projectRoot, p)),
      ],
    });

    // If resolved to a Flow file, try to find the non-Flow version
    if (resolved.endsWith('.flow.js') || resolved.endsWith('.flow')) {
      // Try without .flow extension
      const withoutFlow = resolved.replace(/\.flow(\.js)?$/, '.js');
      if (existsSync(withoutFlow)) {
        resolved = withoutFlow;
      } else {
        // Skip Flow files
        return null;
      }
    }

    return resolved;
  } catch {
    // If require.resolve fails, try manual lookup
    const nodeModulesPaths = [
      resolve(options.projectRoot, 'node_modules'),
      ...resolver.nodeModulesPaths.map((p) => resolve(options.projectRoot, p)),
    ];

    for (const nodeModulesPath of nodeModulesPaths) {
      const packagePath = resolve(nodeModulesPath, moduleSpecifier);
      // Try package.json main field, index.js, etc.
      const extensions = resolver.sourceExts;
      for (const ext of extensions) {
        const withExt = `${packagePath}${ext.startsWith('.') ? '' : '.'}${ext}`;
        if (existsSync(withExt)) {
          return withExt;
        }
      }
      // Try packagePath/index.js
      const indexPath = resolve(packagePath, `index${extensions[0]}`);
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }
  }

  return null;
}

/**
 * Build dependency graph from entry point
 */
export async function buildGraph(options: GraphBuildOptions): Promise<GraphBuildResult> {
  const { entryFile, projectRoot, platform, dev, onProgress } = options;

  // Validate required options
  if (!entryFile) {
    throw new Error('entryFile is required');
  }
  if (!projectRoot) {
    throw new Error('projectRoot is required');
  }

  // Resolve entry file to absolute path
  const entryPath = resolve(projectRoot, entryFile);
  if (!existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  const modules = new Map<string, GraphModule>();
  const visited = new Set<string>();
  const processing = new Set<string>(); // For cycle detection

  let processedCount = 0;
  let totalCount = 0;

  /**
   * Process a module (transform and collect dependencies)
   */
  async function processModule(filePath: string): Promise<GraphModule> {
    // Return cached module first (already fully processed)
    if (modules.has(filePath)) {
      return modules.get(filePath)!;
    }

    // If already processing, it's a circular dependency - return placeholder
    // Circular dependencies are allowed in JavaScript modules
    if (processing.has(filePath)) {
      // Return a placeholder module for circular dependencies
      // The actual module will be filled in when processing completes
      return {
        path: filePath,
        code: '',
        dependencies: [],
        originalDependencies: [],
        processed: false, // Mark as not fully processed yet
      };
    }

    // Mark as processing
    processing.add(filePath);

    // Skip Flow type files
    if (filePath.endsWith('.flow.js') || filePath.endsWith('.flow')) {
      // Return empty module for Flow files
      const module: GraphModule = {
        path: filePath,
        code: '',
        dependencies: [],
        originalDependencies: [],
        processed: true,
      };
      modules.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);
      return module;
    }

    // Skip asset files (images, etc.) and JSON files
    const { assetExts } = options.resolver;
    const isAsset = assetExts.some((ext) => filePath.endsWith(ext));
    const isJSON = filePath.endsWith('.json');
    if (isAsset || isJSON) {
      // Return empty module for asset/JSON files
      // These should be handled separately (not transformed)
      const module: GraphModule = {
        path: filePath,
        code: '',
        dependencies: [],
        originalDependencies: [],
        processed: true,
      };
      modules.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);
      return module;
    }

    // Read file
    const code = readFileSync(filePath, 'utf-8');

    // Transform code using unified pipeline
    // Flow files: Babel + Hermes → SWC
    // Non-Flow files: SWC directly
    const { hasFlowSyntax, transformWithMetroOrder, transformWithSwcCore } =
      await import('../transformer/swc-transformer');
    const hasFlow = await hasFlowSyntax(code, filePath);

    // Debug: Log Flow detection
    if (hasFlow && options.dev) {
      console.log(`[bungae] Flow detected in ${filePath}, using Babel pipeline`);
    }

    let transformedCode: string;

    if (hasFlow) {
      // Flow files: Babel + Hermes for Flow stripping, then SWC for ESM→CJS + JSX
      transformedCode = await transformWithMetroOrder(code, filePath, { dev, platform });
    } else {
      // Non-Flow files: SWC handles everything (ESM→CJS, JSX, TypeScript, define vars)
      transformedCode = await transformWithSwcCore(code, filePath, {
        dev,
        module: 'commonjs',
        platform,
      });
    }

    // Extract dependencies from original code (before transformation)
    // Use SWC for AST-based dependency detection
    // For JSX files, SWC transforms JSX first, then extracts dependencies
    const dependencies = await extractDependencies(code, filePath);

    // Create transform result
    const transformResult = {
      code: transformedCode,
      dependencies,
      map: undefined, // TODO: Extract source map from Bun.build() result
    };

    // Resolve dependencies
    const resolvedDependencies: string[] = [];
    const originalDependencies: string[] = [];
    for (const dep of transformResult.dependencies) {
      // Skip empty or invalid dependencies
      if (!dep || !dep.trim()) {
        continue;
      }

      const resolved = await resolveModule(filePath, dep, options);
      if (resolved) {
        // Always add to dependencies, even if already visited
        // This ensures the dependency is included in the module's dependencyMap
        resolvedDependencies.push(resolved);
        originalDependencies.push(dep); // Keep original path for require conversion

        // Process dependency if not already visited
        if (!visited.has(resolved)) {
          // Will be processed recursively below
        }
      } else if (options.dev) {
        // In dev mode, warn about unresolved dependencies
        // This helps identify missing modules
        console.warn(`[bungae] Failed to resolve dependency "${dep}" from ${filePath}`);
      }
    }

    // Create module
    const module: GraphModule = {
      path: filePath,
      code: transformResult.code,
      map: transformResult.map,
      dependencies: resolvedDependencies,
      originalDependencies: originalDependencies,
      processed: true,
    };

    modules.set(filePath, module);
    visited.add(filePath);

    processedCount++;
    totalCount = Math.max(totalCount, modules.size + resolvedDependencies.length);
    onProgress?.(processedCount, totalCount);

    // Process dependencies recursively
    // Metro processes all dependencies, even if already visited
    // This ensures all transitive dependencies are included
    for (const dep of resolvedDependencies) {
      // Skip if already visited or currently being processed (circular dependency)
      // Circular dependencies are allowed in JavaScript modules
      if (visited.has(dep) || processing.has(dep)) {
        continue;
      }

      // Process dependency if not already visited
      if (!visited.has(dep)) {
        await processModule(dep);
      }
      // Note: Even if already visited, the dependency is still in the dependencyMap
      // This is correct behavior - Metro includes all dependencies in dependencyMap
    }

    // Remove from processing set AFTER all dependencies are processed
    // This ensures we can detect cycles during dependency processing
    processing.delete(filePath);

    return module;
  }

  // Process entry module
  const entryModule = await processModule(entryPath);

  // Metro automatically includes InitializeCore in React Native projects
  // InitializeCore is required to run before the entry point
  // Try to find and include InitializeCore if it's not already in the graph
  // This ensures InitializeCore and its dependencies are included
  try {
    const initializeCorePath = require.resolve('react-native/Libraries/Core/InitializeCore', {
      paths: [projectRoot],
    });

    // Check if InitializeCore is already in the graph
    if (!modules.has(initializeCorePath)) {
      // InitializeCore is not in the graph, add it and process its dependencies
      await processModule(initializeCorePath);
    }
  } catch {
    // InitializeCore not found, skip (might not be a React Native project)
    // This is fine - non-React Native projects don't need InitializeCore
  }

  // Get prepended modules (prelude, metro-runtime, polyfills)
  // Metro uses empty string for globalPrefix to maintain compatibility
  const prepend: SerializerModule[] = getPrependedModules({
    dev,
    globalPrefix: '',
    polyfills: [], // TODO: Add polyfills from config
  });

  return {
    modules,
    entryModule,
    prepend,
  };
}

/**
 * Convert graph modules to serializer modules
 */
export function graphModulesToSerializerModules(
  graphModules: Map<string, GraphModule>,
): SerializerModule[] {
  return Array.from(graphModules.values()).map((module) => ({
    path: module.path,
    code: module.code,
    dependencies: module.dependencies,
    originalDependencies: module.originalDependencies,
    map: module.map,
  }));
}

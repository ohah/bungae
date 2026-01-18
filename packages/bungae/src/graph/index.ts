/**
 * Dependency Graph - Builds dependency graph from entry point
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

import { getPrependedModules } from '../serializer';
import type { Module as SerializerModule } from '../serializer/types';
import { transform } from '../transformer';
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
    // Check for cycles
    if (processing.has(filePath)) {
      throw new Error(`Circular dependency detected: ${filePath}`);
    }

    // Return cached module
    if (modules.has(filePath)) {
      return modules.get(filePath)!;
    }

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

    // Read file
    const code = readFileSync(filePath, 'utf-8');

    // Transform
    const transformResult = await transform(
      {
        filePath,
        code,
        platform,
        dev,
        projectRoot,
      },
      options.transformer,
    );

    // Resolve dependencies
    const resolvedDependencies: string[] = [];
    const originalDependencies: string[] = [];
    for (const dep of transformResult.dependencies) {
      const resolved = await resolveModule(filePath, dep, options);
      if (resolved && !visited.has(resolved)) {
        resolvedDependencies.push(resolved);
        originalDependencies.push(dep); // Keep original path for require conversion
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
    processing.delete(filePath);

    processedCount++;
    totalCount = Math.max(totalCount, modules.size + resolvedDependencies.length);
    onProgress?.(processedCount, totalCount);

    // Process dependencies recursively
    for (const dep of resolvedDependencies) {
      if (!visited.has(dep)) {
        await processModule(dep);
      }
    }

    return module;
  }

  // Process entry module
  const entryModule = await processModule(entryPath);

  // Get prepended modules (prelude, metro-runtime, polyfills)
  const prepend: SerializerModule[] = getPrependedModules({
    dev,
    globalPrefix: '__BUNGAE__',
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

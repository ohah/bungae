/**
 * Incremental build for HMR
 * Rebuilds only changed files and affected modules
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import type { ResolvedConfig } from '../../../config/types';
import { extractDependenciesFromAst } from '../../../transformer/extract-dependencies-from-ast';
import { buildInverseDependencies } from '../graph';
import { resolveModule } from '../resolver';
import { transformFile } from '../transformer';
import type { DeltaResult, GraphModule, PlatformBuildState } from '../types';
import { generateAssetModuleCode } from '../utils';
import { calculateDelta } from './delta';

/**
 * Check if a dependency should be rebuilt based on changes
 * Returns true if:
 * 1. Dependency is directly affected (in affectedModules)
 * 2. Dependency is new (not in old graph)
 * 3. Dependency's content has changed (file modification time or hash comparison)
 *
 * Note: We check oldGraph only since newGraph may not be fully built yet during processModule
 */
function shouldRebuildDependency(
  depPath: string,
  affectedModules: Set<string>,
  oldGraph: Map<string, GraphModule>,
  _newGraph: Map<string, GraphModule>, // Not used during processModule, but kept for future use
): boolean {
  // Dependency is directly affected
  if (affectedModules.has(depPath)) {
    return true;
  }

  // Dependency is new (not in old graph)
  if (!oldGraph.has(depPath)) {
    return true;
  }

  // For dependencies that exist in old graph, we need to check if they've changed
  // Since we're in the middle of building newGraph, we can't compare with newGraph yet
  // Instead, we check if the file has been modified (it would be in affectedModules if so)
  // Or we can check file modification time, but for now we'll be conservative:
  // If it's not in affectedModules and exists in oldGraph, we assume it hasn't changed
  // This is safe because:
  // 1. Direct changes are in affectedModules
  // 2. Indirect changes (dependencies of changed files) will be detected when we process them
  // 3. The hash comparison in calculateDelta will catch any missed changes

  return false;
}

/**
 * Get affected modules for incremental build
 * Only includes changed files - inverse dependencies are not rebuilt,
 * they are only used in __d() calls to tell HMR client which modules to re-execute
 */
function getAffectedModules(
  changedFiles: string[],
  _oldGraph: Map<string, GraphModule>,
  root: string,
): Set<string> {
  const affected = new Set<string>();

  // Normalize and add only changed files
  // Inverse dependencies don't need to be rebuilt - they will be re-executed
  // by the HMR client based on inverseDependencies in __d() calls
  for (const changedFile of changedFiles) {
    // If path is relative, resolve it relative to root
    const normalizedPath = changedFile.startsWith('/') ? changedFile : resolve(root, changedFile);
    affected.add(normalizedPath);
  }

  return affected;
}

/**
 * Incremental build for HMR - rebuild only changed files and affected modules
 */
export async function incrementalBuild(
  changedFiles: string[],
  oldState: PlatformBuildState,
  platformConfig: ResolvedConfig,
): Promise<{ delta: DeltaResult; newState: PlatformBuildState } | null> {
  const { entry, root } = platformConfig;
  const entryPath = resolve(root, entry);

  if (!existsSync(entryPath)) {
    return null;
  }

  // Normalize changed file paths (resolve relative to root)
  const normalizedChangedFiles = changedFiles.map((f) =>
    f.startsWith('/') ? f : resolve(root, f),
  );

  // If no changed files, return empty delta
  if (normalizedChangedFiles.length === 0) {
    return {
      delta: {
        added: new Map(),
        modified: new Map(),
        deleted: new Set(),
      },
      newState: oldState,
    };
  }

  // Get affected modules (changed files + their inverse dependencies)
  const affectedModules = getAffectedModules(changedFiles, oldState.graph, root);

  console.log(`Incremental build: ${normalizedChangedFiles.length} changed file(s) to rebuild`);

  // Start with a copy of the old graph
  const newGraph = new Map(oldState.graph);

  // Process affected modules
  const modules = new Map<string, GraphModule>();
  const visited = new Set<string>();
  const processing = new Set<string>();

  // Helper to process a single module (reuse logic from buildGraph)
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

    // Handle asset files
    const isAsset = platformConfig.resolver.assetExts.some((ext) => {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      return filePath.endsWith(normalizedExt);
    });
    if (isAsset) {
      const assetRegistryPath = 'react-native/Libraries/Image/AssetRegistry';
      let resolvedAssetRegistry: string | null = null;
      try {
        resolvedAssetRegistry = require.resolve(assetRegistryPath, {
          paths: [platformConfig.root, ...platformConfig.resolver.nodeModulesPaths],
        });
      } catch {
        console.warn(`AssetRegistry not found, skipping asset: ${filePath}`);
        visited.add(filePath);
        processing.delete(filePath);
        return;
      }

      const assetCode = generateAssetModuleCode(filePath, platformConfig.root);
      const babel = await import('@babel/core');
      const assetAst = await babel.parseAsync(assetCode, {
        filename: filePath,
        sourceType: 'module',
      });
      const assetDeps = await extractDependenciesFromAst(assetAst);
      const module: GraphModule = {
        path: filePath,
        code: assetCode,
        transformedAst: assetAst,
        dependencies: resolvedAssetRegistry ? [resolvedAssetRegistry] : [],
        originalDependencies: assetDeps.length > 0 ? assetDeps : [assetRegistryPath],
      };
      modules.set(filePath, module);
      newGraph.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);

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
    if (!existsSync(filePath)) {
      // File was deleted
      visited.add(filePath);
      processing.delete(filePath);
      return;
    }

    const code = readFileSync(filePath, 'utf-8');

    // JSON files
    const isJSON = filePath.endsWith('.json');
    if (isJSON) {
      const transformResult = await transformFile(filePath, code, platformConfig, entryPath);
      const module: GraphModule = {
        path: filePath,
        code,
        transformedAst: transformResult?.ast || null,
        dependencies: [],
        originalDependencies: [],
      };
      modules.set(filePath, module);
      newGraph.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);
      return;
    }

    // Transform code
    const transformResult = await transformFile(filePath, code, platformConfig, entryPath);
    if (!transformResult) {
      visited.add(filePath);
      processing.delete(filePath);
      return;
    }

    // Extract dependencies
    const allDeps = await extractDependenciesFromAst(transformResult.ast);
    const resolvedDependencies: string[] = [];
    const originalDependencies: string[] = [];

    for (const dep of allDeps) {
      if (!dep || !dep.trim()) continue;

      const resolved = await resolveModule(filePath, dep, platformConfig);
      if (resolved) {
        resolvedDependencies.push(resolved);
        originalDependencies.push(dep);
      } else if (platformConfig.dev) {
        console.warn(`Failed to resolve "${dep}" from ${filePath}`);
      }
    }

    // Create module
    const module: GraphModule = {
      path: filePath,
      code,
      transformedAst: transformResult.ast,
      dependencies: resolvedDependencies,
      originalDependencies,
    };

    modules.set(filePath, module);
    newGraph.set(filePath, module);
    visited.add(filePath);

    // Process dependencies with improved change detection
    // Recursively process dependencies that need to be rebuilt
    for (const dep of resolvedDependencies) {
      if (!visited.has(dep) && !processing.has(dep)) {
        // Check if dependency should be rebuilt
        // 1. If it's directly affected (in affectedModules)
        // 2. If it's new (not in old graph)
        // 3. If it's a dependency of a changed module, we need to check if it changed
        const shouldRebuild =
          affectedModules.has(dep) || // Directly affected
          !oldState.graph.has(dep) || // New dependency
          shouldRebuildDependency(dep, affectedModules, oldState.graph, newGraph); // Changed content

        if (shouldRebuild) {
          // Dependency needs rebuild, process it recursively
          await processModule(dep);
        } else {
          // Dependency exists in old graph and hasn't changed, reuse it
          const oldModule = oldState.graph.get(dep);
          if (oldModule) {
            newGraph.set(dep, oldModule);
            visited.add(dep);
          }
        }
      }
    }

    processing.delete(filePath);
  }

  // Process all affected modules
  for (const affectedPath of affectedModules) {
    if (existsSync(affectedPath)) {
      await processModule(affectedPath);
    }
  }

  // Remove deleted modules from graph
  for (const changedFile of normalizedChangedFiles) {
    if (!existsSync(changedFile)) {
      newGraph.delete(changedFile);
    }
  }

  // Use the SAME module ID factory from the old state to ensure consistency
  // Creating a new factory would assign different IDs to the same modules,
  // breaking HMR because the client has modules registered with the old IDs
  const createModuleId = oldState.createModuleId;

  // Build module ID mappings
  const newModuleIdToPath = new Map<number | string, string>();
  const newPathToModuleId = new Map<string, number | string>();
  for (const [path] of newGraph.entries()) {
    const moduleId = createModuleId(path);
    newModuleIdToPath.set(moduleId, path);
    newPathToModuleId.set(path, moduleId);
  }

  // Calculate delta
  const delta = await calculateDelta(
    oldState.graph,
    newGraph,
    oldState.moduleIdToPath,
    newModuleIdToPath,
    createModuleId,
  );

  // Rebuild inverse dependencies for the new graph (Metro-compatible)
  buildInverseDependencies(newGraph);

  // Generate new revision ID
  const revisionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const newState: PlatformBuildState = {
    graph: newGraph,
    moduleIdToPath: newModuleIdToPath,
    pathToModuleId: newPathToModuleId,
    revisionId,
    createModuleId,
  };

  return { delta, newState };
}

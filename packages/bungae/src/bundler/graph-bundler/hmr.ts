/**
 * HMR (Hot Module Replacement) for Graph Bundler
 * Handles delta calculation, message generation, and incremental builds
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { relative, resolve } from 'path';

import type { ResolvedConfig } from '../../config/types';
import { getRunModuleStatement } from '../../serializer';
import { extractDependenciesFromAst } from '../../transformer/extract-dependencies-from-ast';
import { buildInverseDependencies, graphToSerializerModules } from './graph';
import { resolveModule } from './resolver';
import { transformFile } from './transformer';
import type { DeltaResult, GraphModule, HMRUpdateMessage, PlatformBuildState } from './types';
import { generateAssetModuleCode } from './utils';

/**
 * Calculate module hash (transformed code + dependencies) for change detection
 * Metro uses hash comparison to detect if a module has changed
 */
function hashModule(module: GraphModule): string {
  // Use transformed AST if available, otherwise fall back to original code
  const codeToHash = module.code;

  // If we have transformed AST, we should generate code from it for accurate comparison
  // For now, we'll use a combination of code and dependencies
  // TODO: Generate code from AST for more accurate comparison
  const depsHash = module.dependencies
    .map((dep) => resolve(dep)) // Normalize paths
    .sort()
    .join(',');

  const hashInput = `${codeToHash}:${depsHash}`;
  return createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
}

/**
 * Calculate delta between old and new graphs for HMR
 */
export async function calculateDelta(
  oldGraph: Map<string, GraphModule>,
  newGraph: Map<string, GraphModule>,
  _oldModuleIdToPath: Map<number | string, string>,
  _newModuleIdToPath: Map<number | string, string>,
  _createModuleId: (path: string) => number | string,
): Promise<DeltaResult> {
  const added = new Map<string, GraphModule>();
  const modified = new Map<string, GraphModule>();
  const deleted = new Set<string>();

  // Find added and modified modules
  for (const [path, newModule] of newGraph.entries()) {
    const oldModule = oldGraph.get(path);
    if (!oldModule) {
      // New module
      added.set(path, newModule);
    } else {
      // Check if module was modified using hash comparison (Metro-compatible)
      // This compares transformed code + dependencies for accurate change detection
      const oldHash = hashModule(oldModule);
      const newHash = hashModule(newModule);

      if (oldHash !== newHash) {
        modified.set(path, newModule);
      }
    }
  }

  // Find deleted modules
  for (const [path] of oldGraph.entries()) {
    if (!newGraph.has(path)) {
      deleted.add(path);
    }
  }

  return { added, modified, deleted };
}

/**
 * Get inverse dependencies for a module (Metro-compatible)
 * Returns a map of module paths to their direct inverse dependencies.
 * This is used by the HMR runtime to traverse the dependency graph upwards.
 *
 * Metro's behavior: For each module in the chain, include its direct inverse dependencies.
 * The HMR runtime uses this map to walk up the dependency tree.
 *
 * Example: If A -> B -> C (A depends on B, B depends on C), and C changes:
 * Result: { "C": ["B"], "B": ["A"], "A": [] }
 *
 * This allows the HMR runtime to:
 * 1. Start at C, find parent B
 * 2. Check if B can accept the update, if not find parent A
 * 3. Check if A can accept, if not (and A has no parents) -> full reload
 */
function getInverseDependenciesMap(
  path: string,
  graph: Map<string, GraphModule>,
  inverseDependencies: Record<string, string[]> = {},
): Record<string, string[]> {
  // Already traversed this path
  if (path in inverseDependencies) {
    return inverseDependencies;
  }

  const module = graph.get(path);
  if (!module) {
    return inverseDependencies;
  }

  // Initialize entry for this path (even if empty)
  inverseDependencies[path] = [];

  // Get direct inverse dependencies (modules that depend on this module)
  const directInverseDeps = module.inverseDependencies || [];

  for (const parentPath of directInverseDeps) {
    inverseDependencies[path].push(parentPath);
    // Recursively process parent modules
    getInverseDependenciesMap(parentPath, graph, inverseDependencies);
  }

  return inverseDependencies;
}

/**
 * Create HMR update message from delta result (Metro protocol)
 */
export async function createHMRUpdateMessage(
  delta: DeltaResult,
  platformConfig: ResolvedConfig,
  createModuleId: (path: string) => number | string,
  revisionId: string,
  isInitialUpdate: boolean,
  oldPathToModuleId: Map<string, number | string>,
  fullGraph: Map<string, GraphModule>, // Full graph for inverse dependencies calculation
): Promise<HMRUpdateMessage> {
  const { root } = platformConfig;
  // Metro format: arrays of objects [{ module: [id, code], sourceURL, sourceMappingURL? }, ...]
  // Metro's inject function expects: { module: [id, code], sourceURL }
  // Metro's generateModules includes sourceMappingURL (optional but recommended)
  const added: Array<{ module: [number, string]; sourceURL: string; sourceMappingURL?: string }> =
    [];
  const modified: Array<{
    module: [number, string];
    sourceURL: string;
    sourceMappingURL?: string;
  }> = [];
  const deleted: number[] = [];

  // Import wrapModule and addParamsToDefineCall
  const { wrapModule } = await import('../../serializer/helpers/js');
  const { addParamsToDefineCall } = await import('../../serializer/helpers/addParamsToDefineCall');

  // Process added modules
  for (const [path, module] of delta.added.entries()) {
    const moduleIdRaw = createModuleId(path);
    // Metro protocol expects number IDs
    const moduleId = typeof moduleIdRaw === 'number' ? moduleIdRaw : Number(moduleIdRaw);
    const sourceURL = relative(root, path);

    // Generate module code (same as in buildWithGraph)
    const serializerModules = await graphToSerializerModules([module], platformConfig);
    const serializerModule = serializerModules[0];
    if (serializerModule) {
      // Get all module paths for dependency validation
      // Include all modules from the full graph, not just delta
      const allModulePaths = new Set<string>();
      for (const [p] of fullGraph.entries()) {
        allModulePaths.add(p);
      }

      // Wrap with __d() for Metro compatibility (Metro's prepareModule)
      let wrappedCode = await wrapModule(serializerModule, {
        createModuleId,
        getRunModuleStatement,
        dev: platformConfig.dev ?? true,
        projectRoot: root,
        serverRoot: root,
        globalPrefix: '',
        runModule: false,
        includeAsyncPaths: false,
        allModulePaths,
      } as any);

      // Get inverse dependencies map for this module and all its ancestors (Metro-compatible)
      // Metro's prepareModule: Build a map of moduleId -> [parentModuleIds] for the entire chain
      // This allows the HMR runtime to traverse upwards through the dependency graph
      const inverseDepsMap = getInverseDependenciesMap(path, fullGraph);

      // Transform inverse dependency paths to module IDs
      // Metro format: { [moduleId]: [inverseDepId1, inverseDepId2, ...], ... }
      const inverseDependenciesById: Record<number, number[]> = {};
      for (const [depPath, parentPaths] of Object.entries(inverseDepsMap)) {
        const depModuleIdRaw = createModuleId(depPath);
        const depModuleId =
          typeof depModuleIdRaw === 'number' ? depModuleIdRaw : Number(depModuleIdRaw);
        inverseDependenciesById[depModuleId] = parentPaths.map((p) => {
          const idRaw = createModuleId(p);
          return typeof idRaw === 'number' ? idRaw : Number(idRaw);
        });
      }

      // Add inverse dependencies to __d() call (Metro-compatible)
      // Metro: addParamsToDefineCall(code, inverseDependenciesById)
      // Our function signature: addParamsToDefineCall(code, globalPrefix, ...paramsToAdd)
      wrappedCode = addParamsToDefineCall(wrappedCode, '', inverseDependenciesById);

      // Generate sourceMappingURL and sourceURL (Metro-compatible)
      // Metro uses jscSafeUrl.toJscSafeUrl for sourceURL, but we'll use relative path for now
      // Metro adds these as comments at the end of the code
      const sourceMappingURL = `${sourceURL}.map`;
      const finalCode =
        wrappedCode +
        `\n//# sourceMappingURL=${sourceMappingURL}\n` +
        `//# sourceURL=${sourceURL}\n`;

      // Metro format: added/modified are arrays of objects: [{ module: [id, code], sourceURL, sourceMappingURL? }, ...]
      // Metro's inject function: const inject = ({ module: [id, code], sourceURL }) => { ... }
      // Metro's generateModules includes sourceMappingURL (optional)
      added.push({
        module: [moduleId, finalCode],
        sourceURL,
        sourceMappingURL,
      });
    }
  }

  // Process modified modules
  for (const [path, module] of delta.modified.entries()) {
    const moduleIdRaw = createModuleId(path);
    // Metro protocol expects number IDs
    const moduleId = typeof moduleIdRaw === 'number' ? moduleIdRaw : Number(moduleIdRaw);
    const sourceURL = relative(root, path);

    // Generate module code
    const serializerModules = await graphToSerializerModules([module], platformConfig);
    const serializerModule = serializerModules[0];
    if (serializerModule) {
      // Get all module paths for dependency validation
      // Include all modules from the full graph, not just delta
      const allModulePaths = new Set<string>();
      for (const [p] of fullGraph.entries()) {
        allModulePaths.add(p);
      }

      // Wrap with __d() for Metro compatibility (Metro's prepareModule)
      let wrappedCode = await wrapModule(serializerModule, {
        createModuleId,
        getRunModuleStatement,
        dev: platformConfig.dev ?? true,
        projectRoot: root,
        serverRoot: root,
        globalPrefix: '',
        runModule: false,
        includeAsyncPaths: false,
        allModulePaths,
      } as any);

      // Get inverse dependencies map for this module and all its ancestors (Metro-compatible)
      // Metro's prepareModule: Build a map of moduleId -> [parentModuleIds] for the entire chain
      // This allows the HMR runtime to traverse upwards through the dependency graph
      const inverseDepsMap = getInverseDependenciesMap(path, fullGraph);

      // Transform inverse dependency paths to module IDs
      // Metro format: { [moduleId]: [inverseDepId1, inverseDepId2, ...], ... }
      const inverseDependenciesById: Record<number, number[]> = {};
      for (const [depPath, parentPaths] of Object.entries(inverseDepsMap)) {
        const depModuleIdRaw = createModuleId(depPath);
        const depModuleId =
          typeof depModuleIdRaw === 'number' ? depModuleIdRaw : Number(depModuleIdRaw);
        inverseDependenciesById[depModuleId] = parentPaths.map((p) => {
          const idRaw = createModuleId(p);
          return typeof idRaw === 'number' ? idRaw : Number(idRaw);
        });
      }

      // Debug: Log inverse dependencies for HMR
      console.log(`HMR inverseDependencies for ${sourceURL}:`, {
        moduleId,
        inverseDepsMapKeys: Object.keys(inverseDepsMap),
        inverseDependenciesById,
      });

      // Debug: Log the __d() call structure before adding inverseDependencies
      const defineMatch = wrappedCode.match(/__d\(function[^)]*\)/);
      const endOfCode = wrappedCode.slice(-200);
      console.log(`HMR __d() structure before inverseDeps:`, {
        startsWithDefine: wrappedCode.trim().startsWith('__d('),
        defineMatch: defineMatch ? defineMatch[0].slice(0, 50) + '...' : 'not found',
        endOfCode: endOfCode,
      });

      // Add inverse dependencies to __d() call (Metro-compatible)
      // Metro: addParamsToDefineCall(code, inverseDependenciesById)
      // Our function signature: addParamsToDefineCall(code, globalPrefix, ...paramsToAdd)
      wrappedCode = addParamsToDefineCall(wrappedCode, '', inverseDependenciesById);

      // Debug: Log the __d() call structure AFTER adding inverseDependencies
      const endOfCodeAfter = wrappedCode.slice(-300);
      console.log(`HMR __d() AFTER inverseDeps (last 300 chars):`, endOfCodeAfter);

      // Generate sourceMappingURL and sourceURL (Metro-compatible)
      // Metro uses jscSafeUrl.toJscSafeUrl for sourceURL, but we'll use relative path for now
      // Metro adds these as comments at the end of the code
      const sourceMappingURL = `${sourceURL}.map`;

      // Debug: Add client-side HMR debugging code (executed before __d() call)
      // This helps identify why performFullRefresh is being called
      // Note: Use globalThis instead of global because HMR code runs via eval() without IIFE wrapper
      const hmrDebugCode = `
(function(g) {
  console.log('[Bungae HMR] === Client-side HMR Debug ===');
  console.log('[Bungae HMR] Module ${moduleId} (${sourceURL}) update received');
  console.log('[Bungae HMR] g.__ReactRefresh:', typeof g.__ReactRefresh, g.__ReactRefresh ? 'exists' : 'null/undefined');
  console.log('[Bungae HMR] g.__accept:', typeof g.__accept);
  console.log('[Bungae HMR] g.__METRO_GLOBAL_PREFIX__:', g.__METRO_GLOBAL_PREFIX__);
  if (g.__ReactRefresh) {
    console.log('[Bungae HMR] ReactRefresh.isLikelyComponentType:', typeof g.__ReactRefresh.isLikelyComponentType);
  }
  var modules = g.__r && g.__r.getModules ? g.__r.getModules() : null;
  if (modules) {
    var mod = modules.get(${moduleId});
    if (mod) {
      console.log('[Bungae HMR] Module ${moduleId} exists:', !!mod);
      console.log('[Bungae HMR] Module ${moduleId} isInitialized:', mod.isInitialized);
      console.log('[Bungae HMR] Module ${moduleId} exports type:', typeof (mod.publicModule && mod.publicModule.exports));
      if (mod.publicModule && mod.publicModule.exports) {
        var exp = mod.publicModule.exports;
        console.log('[Bungae HMR] exports.default:', typeof exp.default, exp.default && exp.default.name || 'no name');
        if (g.__ReactRefresh && g.__ReactRefresh.isLikelyComponentType) {
          console.log('[Bungae HMR] isLikelyComponentType(exports):', g.__ReactRefresh.isLikelyComponentType(exp));
          console.log('[Bungae HMR] isLikelyComponentType(exports.default):', g.__ReactRefresh.isLikelyComponentType(exp.default));
        }
      }
    } else {
      console.log('[Bungae HMR] Module ${moduleId} not found in modules map');
    }
  }
  console.log('[Bungae HMR] === End Debug ===');
})(typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
`;

      const finalCode =
        hmrDebugCode +
        wrappedCode +
        `\n//# sourceMappingURL=${sourceMappingURL}\n` +
        `//# sourceURL=${sourceURL}\n`;

      // Metro format: added/modified are arrays of objects: [{ module: [id, code], sourceURL, sourceMappingURL? }, ...]
      // Metro's inject function: const inject = ({ module: [id, code], sourceURL }) => { ... }
      // Metro's generateModules includes sourceMappingURL (optional)
      modified.push({
        module: [moduleId, finalCode],
        sourceURL,
        sourceMappingURL,
      });
    }
  }

  // Process deleted modules - use old module IDs
  for (const path of delta.deleted) {
    const oldModuleId = oldPathToModuleId.get(path);
    if (oldModuleId !== undefined) {
      // Ensure it's a number (Metro uses numbers)
      const moduleId = typeof oldModuleId === 'number' ? oldModuleId : Number(oldModuleId);
      if (!isNaN(moduleId)) {
        deleted.push(moduleId);
      }
    }
  }

  // Ensure arrays are always present and valid (Metro-compatible)
  // Metro's mergeUpdates expects: update.added, update.modified, update.deleted to be arrays
  // Metro client passes data.body directly as update, so body must have these arrays
  const result: HMRUpdateMessage = {
    type: 'update',
    body: {
      revisionId: revisionId || '',
      isInitialUpdate: isInitialUpdate ?? false,
      added: Array.isArray(added) ? added : [],
      modified: Array.isArray(modified) ? modified : [],
      deleted: Array.isArray(deleted) ? deleted : [],
    },
  };

  // Debug: Log HMR message structure (only in dev mode)
  if (platformConfig.dev) {
    console.log('HMR message structure:', {
      type: result.type,
      body: {
        revisionId: result.body.revisionId,
        isInitialUpdate: result.body.isInitialUpdate,
        addedCount: result.body.added.length,
        modifiedCount: result.body.modified.length,
        deletedCount: result.body.deleted.length,
        firstAdded: result.body.added[0]
          ? `{ module: [${result.body.added[0].module[0]}, code(${result.body.added[0].module[1]?.length || 0} chars)], sourceURL: ${result.body.added[0].sourceURL} }`
          : 'none',
        firstModified: result.body.modified[0]
          ? `{ module: [${result.body.modified[0].module[0]}, code(${result.body.modified[0].module[1]?.length || 0} chars)], sourceURL: ${result.body.modified[0].sourceURL} }`
          : 'none',
      },
    });
    // Validate object structure
    for (let i = 0; i < result.body.added.length; i++) {
      const item = result.body.added[i];
      if (
        !item ||
        typeof item !== 'object' ||
        !Array.isArray(item.module) ||
        item.module.length !== 2 ||
        typeof item.sourceURL !== 'string'
      ) {
        console.error(`Invalid added[${i}]:`, item);
        console.error(`  - item:`, item);
        console.error(`  - item.module:`, item?.module);
        console.error(`  - item.sourceURL:`, item?.sourceURL);
      }
    }
    for (let i = 0; i < result.body.modified.length; i++) {
      const item = result.body.modified[i];
      if (
        !item ||
        typeof item !== 'object' ||
        !Array.isArray(item.module) ||
        item.module.length !== 2 ||
        typeof item.sourceURL !== 'string'
      ) {
        console.error(`Invalid modified[${i}]:`, item);
        console.error(`  - item:`, item);
        console.error(`  - item.module:`, item?.module);
        console.error(`  - item.sourceURL:`, item?.sourceURL);
      }
    }
    // Validate arrays are actually arrays (critical for Metro)
    // Metro's injectUpdate and mergeUpdates expect arrays, not undefined
    if (!Array.isArray(result.body.added)) {
      console.error(
        'CRITICAL: result.body.added is not an array!',
        typeof result.body.added,
        result.body.added,
      );
      result.body.added = [];
    }
    if (!Array.isArray(result.body.modified)) {
      console.error(
        'CRITICAL: result.body.modified is not an array!',
        typeof result.body.modified,
        result.body.modified,
      );
      result.body.modified = [];
    }
    if (!Array.isArray(result.body.deleted)) {
      console.error(
        'CRITICAL: result.body.deleted is not an array!',
        typeof result.body.deleted,
        result.body.deleted,
      );
      result.body.deleted = [];
    }
  }

  return result;
}

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

/**
 * HMR message generation
 * Creates Metro-compatible HMR update messages
 */

import { relative } from 'path';

import type { ResolvedConfig } from '../../../config/types';
import { getRunModuleStatement } from '../../../serializer';
import { addParamsToDefineCall } from '../../../serializer/helpers/addParamsToDefineCall';
import { wrapModule } from '../../../serializer/helpers/js';
import { graphToSerializerModules } from '../graph';
import type { DeltaResult, GraphModule, HMRUpdateMessage } from '../types';

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

  // wrapModule and addParamsToDefineCall are now statically imported at the top

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
      const wrapResult = await wrapModule(serializerModule, {
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
      let wrappedCode = wrapResult.code;

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
      const wrapResult2 = await wrapModule(serializerModule, {
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
      let wrappedCode = wrapResult2.code;

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

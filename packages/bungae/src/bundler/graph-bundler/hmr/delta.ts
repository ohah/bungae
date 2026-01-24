/**
 * Delta calculation for HMR
 * Compares old and new graphs to detect changes
 */

import { createHash } from 'crypto';
import { resolve } from 'path';

import type { DeltaResult, GraphModule } from '../types';

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

/**
 * Dependency Graph - Builds dependency graph from entry point
 *
 * NOTE: Currently NOT USED. The actual graph building is done in graph-bundler.ts
 * using Babel + Hermes Parser for Metro compatibility.
 *
 * This module used SWC for transformation which is not Metro-compatible.
 * Kept for future optimization when SWC transformation is re-enabled.
 *
 * See: bundler/graph-bundler.ts for the actual implementation.
 */

import type { Module as SerializerModule } from '../serializer/types';
import type { GraphBuildOptions, GraphBuildResult, GraphModule } from './types';

// Re-export types for API compatibility
export type { GraphBuildOptions, GraphBuildResult, GraphModule };

// Stub exports for API compatibility (not actually used)
export async function buildGraph(_options: GraphBuildOptions): Promise<GraphBuildResult> {
  throw new Error(
    'buildGraph() from graph/index.ts is not used. ' +
      'Use buildWithGraph() from bundler/graph-bundler.ts instead.',
  );
}

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

/*
 * Original implementation (kept for reference):
 *
 * This module provided:
 * - buildGraph(): Build dependency graph with SWC transformation
 * - graphModulesToSerializerModules(): Convert graph modules to serializer format
 *
 * Transformation pipeline was:
 * - Flow files: Babel + Hermes → SWC (ESM→CJS + JSX)
 * - Non-Flow files: SWC directly (all transformations)
 *
 * This was different from Metro which uses Babel for all transformations.
 * The current graph-bundler.ts uses Babel for Metro compatibility.
 */

/**
 * Transformer - Unified code transformation pipeline
 *
 * NOTE: Currently NOT USED. The actual transformation happens in graph-bundler.ts
 * using @react-native/babel-preset directly (Metro-compatible).
 *
 * This file is kept for API compatibility and future optimization.
 * See: bundler/graph-bundler.ts for the actual transformation logic.
 */

// import type { TransformerConfig } from '../config/types';
// import { hasFlowSyntax, stripFlowTypesWithBabel, transformWithSwcCore } from './swc-transformer';
// import type { TransformOptions, TransformResult } from './types';
// import { extractDependencies } from './utils';

/*
 * All transformation code below is commented out.
 * The actual transformation is done in graph-bundler.ts using:
 * - Hermes Parser for Flow syntax
 * - @react-native/babel-preset for all transformations
 *
 * export async function transform(options, config): Promise<TransformResult> { ... }
 */

// Re-export types for API compatibility
export * from './types';

// Stub exports for API compatibility (not actually used)
export async function transform(): Promise<{ code: string; dependencies: string[]; map?: string }> {
  throw new Error(
    'transform() is not used. Transformation is done in graph-bundler.ts using Babel.',
  );
}

/**
 * Dependency Resolution Tests (Metro-compatible)
 *
 * NOTE: These tests are SKIPPED because graph/index.ts buildGraph is not currently used.
 * We're using graph-bundler.ts with Babel + Hermes Parser instead for Metro compatibility.
 *
 * The graph/index.ts buildGraph used SWC for transformation which is different from Metro.
 * See: bundler/graph-bundler.ts for the actual implementation.
 * See: bundler/__tests__/graph-bundler.test.ts for current bundle tests.
 */

import { describe, test } from 'bun:test';

describe('Dependency Resolution (Metro-compatible)', () => {
  test.skip('tests are skipped - graph/index.ts buildGraph is not used', () => {
    // graph/index.ts buildGraph is commented out
    // Using graph-bundler.ts buildWithGraph for Metro-compatible bundling instead
  });
});

/*
 * Original tests (kept for reference):
 *
 * - should resolve all transitive dependencies
 * - should handle circular dependencies
 * - should resolve platform-specific files
 * - should resolve node_modules packages
 * - should include all dependencies in dependencyMap
 * - should handle require() calls in addition to imports
 * - should handle dynamic imports
 * - should process all transitive dependencies recursively
 */

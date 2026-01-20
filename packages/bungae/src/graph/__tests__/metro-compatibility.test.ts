/**
 * Metro Compatibility Tests
 *
 * NOTE: These tests are SKIPPED because graph/index.ts buildGraph is not currently used.
 * We're using graph-bundler.ts with Babel + Hermes Parser instead for Metro compatibility.
 *
 * The graph/index.ts buildGraph used SWC for transformation which is different from Metro.
 * See: bundler/graph-bundler.ts for the actual implementation.
 * See: bundler/__tests__/graph-bundler.test.ts for current bundle tests.
 */

import { describe, test } from 'bun:test';

describe('Metro Compatibility', () => {
  test.skip('tests are skipped - graph/index.ts buildGraph is not used', () => {
    // graph/index.ts buildGraph is commented out
    // Using graph-bundler.ts buildWithGraph for Metro-compatible bundling instead
  });
});

/*
 * Original tests (kept for reference):
 *
 * - should include all transitive dependencies like Metro
 * - should generate Metro-compatible bundle format
 * - should include dependencies in dependencyMap like Metro
 * - should handle both import and require statements
 * - should extract dependencies from transformed code correctly
 */

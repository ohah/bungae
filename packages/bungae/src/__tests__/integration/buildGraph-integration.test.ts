/**
 * Copyright (c) 2026 ohah
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * NOTE: These tests are SKIPPED because graph/index.ts buildGraph is not currently used.
 * We're using graph-bundler.ts with Babel + Hermes Parser instead for Metro compatibility.
 *
 * The graph/index.ts buildGraph used SWC for transformation which is different from Metro.
 * See: bundler/graph-bundler.ts for the actual implementation.
 * See: bundler/__tests__/graph-bundler.test.ts for current bundle tests.
 */

import { describe, test } from 'bun:test';

describe('BuildGraph Integration Tests', () => {
  test.skip('tests are skipped - graph/index.ts buildGraph is not used', () => {
    // graph/index.ts buildGraph is commented out
    // Using graph-bundler.ts buildWithGraph for Metro-compatible bundling instead
  });
});

/*
 * Original tests (kept for reference):
 *
 * - should build dependency graph from entry point
 * - should include all dependencies in graph
 * - should handle platform-specific resolution
 * - should build graph with progress callback
 */

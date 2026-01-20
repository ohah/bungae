/**
 * Bundle Snapshot Tests
 *
 * NOTE: These tests are SKIPPED because they test bun-bundler.ts which is not currently used.
 * We're using graph-bundler.ts with Metro __d()/__r() module system instead.
 *
 * The graph bundler produces different output (Metro-compatible format) than bun-bundler,
 * so these tests don't apply. See graph-bundler.test.ts for current bundle tests.
 */

import { describe, test } from 'bun:test';

describe('Bundle Snapshot Tests', () => {
  test.skip('tests are skipped - bun-bundler is not used', () => {
    // bun-bundler.ts is commented out
    // Using graph-bundler.ts for Metro-compatible output instead
  });
});

/*
 * Original tests (kept for reference):
 *
 * Bundle Structure:
 * - should have correct global variables at the start
 * - should have development-only variables in dev mode
 * - should NOT have development variables in production mode
 * - should set correct platform
 *
 * Code Transformation:
 * - should transform JSX correctly
 * - should transform TypeScript correctly
 * - should handle ES modules
 *
 * Bundle Content Snapshot:
 * - simple bundle structure snapshot
 * - bundle sections order
 * - should generate sourcemap in dev mode
 * - should NOT generate sourcemap in production mode
 *
 * Error Handling:
 * - should throw error for non-existent entry file
 */

/**
 * Bun Transformer Tests
 *
 * NOTE: These tests are SKIPPED because bun-transformer.ts is not currently used.
 * We're using Babel + Hermes Parser instead for Metro compatibility.
 * See: graph-bundler.ts for the actual transformation logic.
 */

import { describe, test } from 'bun:test';

describe('Bun Transformer', () => {
  test.skip('tests are skipped - bun-transformer is not used', () => {
    // bun-transformer.ts is commented out
    // Using Babel + Hermes Parser for Metro compatibility instead
  });
});

/*
 * Original tests (kept for reference when re-enabling bun-transformer):
 *
 * - should transform TypeScript to JavaScript
 * - should transform TSX to JavaScript
 * - should transform JSX to JavaScript
 * - should inject __DEV__ variable
 * - should inject process.env.NODE_ENV
 * - should extract dependencies from require()
 * - should extract dependencies from import statements
 * - should extract dependencies from dynamic import
 * - should handle production mode
 * - should handle different platforms
 */

/**
 * Hermes Compatibility Plugin for Rolldown
 *
 * Downlevels JavaScript syntax that Hermes doesn't support:
 * - Private class fields (#field) → string-key property (loose mode)
 * - Private methods (#method()) → string-key property (loose mode)
 *
 * Uses SWC in the `transform` hook (per-module, before bundling) to convert
 * private fields before Rolldown wraps classes into class expressions.
 *
 * Why `transform` instead of `renderChunk`:
 * Rolldown converts class declarations to class expressions during bundling
 * (e.g., `var Foo = class Foo1 { ... }`). SWC's private field transform on
 * class expressions creates comma expressions (`Foo = (_x = key(), class Foo1 { })`),
 * which Hermes cannot parse. By transforming in `transform` (before bundling),
 * private fields are already removed when Rolldown processes the class.
 *
 * This is the same approach used by Rollipop (reference Rolldown-based RN bundler).
 *
 * Target: ES2020 with assumptions.privateFieldsAsProperties
 */

import type { Plugin } from 'rolldown';

export function hermesCompatPlugin(): Plugin {
  let swcModule: typeof import('@swc/core') | null = null;

  return {
    name: 'bungae:hermes-compat',

    // transform runs on each module individually, before Rolldown bundles them.
    // At this stage, classes are still declarations (not expressions), so SWC's
    // private field transform produces clean output without comma expressions.
    async transform(code, id) {
      // Only process JS/TS files
      if (!/\.[mc]?[jt]sx?$/.test(id)) {
        return null;
      }

      // Quick check: skip if no private fields
      if (!code.includes('#')) {
        return null;
      }

      // Only transform if there are actual private field patterns
      if (!/(?:this\.#|\.#[a-zA-Z_]|#[a-zA-Z_]\w*[;=,()])/.test(code)) {
        return null;
      }

      try {
        if (!swcModule) {
          swcModule = await import('@swc/core');
        }

        const result = await swcModule.transform(code, {
          filename: id,
          jsc: {
            parser: {
              syntax: id.endsWith('.ts') || id.endsWith('.tsx') ? 'typescript' : 'ecmascript',
              tsx: id.endsWith('.tsx'),
            },
            target: 'es2020',
            assumptions: {
              setPublicClassFields: true,
              privateFieldsAsProperties: true,
            },
          },
          sourceMaps: true,
        });

        return {
          code: result.code,
          map: result.map || undefined,
        };
      } catch (error: any) {
        console.warn(
          `[hermes-compat] SWC transform failed for ${id}, returning original code: ${error.message}`,
        );
        return null;
      }
    },
  };
}

/**
 * SWC Transformer - Main transformer using SWC for all code transformations
 *
 * NOTE: Currently NOT USED. Using Babel + Hermes Parser instead for Metro compatibility.
 * The actual transformation is done in graph-bundler.ts using @react-native/babel-preset.
 *
 * This module was used by graph/index.ts for SWC-based transformation.
 * Kept for future optimization when SWC transformation is re-enabled.
 *
 * See: bundler/graph-bundler.ts for the actual transformation logic.
 */

// Stub exports for API compatibility (not actually used)
export async function hasFlowSyntax(_code: string, _filePath?: string): Promise<boolean> {
  throw new Error(
    'hasFlowSyntax() is not used. Transformation is done in graph-bundler.ts using Babel.',
  );
}

export async function stripFlowTypesWithBabel(_code: string, _filePath?: string): Promise<string> {
  throw new Error(
    'stripFlowTypesWithBabel() is not used. Transformation is done in graph-bundler.ts using Babel.',
  );
}

export async function transformWithSwcCore(
  _code: string,
  _filePath: string,
  _options: { dev: boolean; module?: 'commonjs' | 'es6'; platform?: string },
): Promise<string> {
  throw new Error(
    'transformWithSwcCore() is not used. Transformation is done in graph-bundler.ts using Babel.',
  );
}

export async function transformWithMetroOrder(
  _code: string,
  _filePath: string,
  _options: { dev: boolean; platform: string },
): Promise<string> {
  throw new Error(
    'transformWithMetroOrder() is not used. Transformation is done in graph-bundler.ts using Babel.',
  );
}

export function injectDefineVariables(_code: string, _platform: string, _dev: boolean): string {
  throw new Error(
    'injectDefineVariables() is not used. Transformation is done in graph-bundler.ts using Babel.',
  );
}

/*
 * Original implementation (kept for reference):
 *
 * This module provided:
 * - hasFlowSyntax(): Detect Flow syntax in code
 * - stripFlowTypesWithBabel(): Strip Flow types using Babel + Hermes
 * - transformWithSwcCore(): Transform code with SWC (ESM→CJS, JSX, TypeScript)
 * - transformWithMetroOrder(): Full pipeline for Flow files (Babel + SWC)
 * - injectDefineVariables(): Inject __DEV__, __PLATFORM__ (now handled by SWC optimizer)
 *
 * Transformation pipeline was:
 * - Flow files: Babel + Hermes (Flow stripping) → SWC (ESM→CJS + JSX)
 * - Non-Flow files: SWC directly (all transformations)
 *
 * The current graph-bundler.ts uses Babel for all transformations (Metro-compatible).
 */

/**
 * Transformer - Code transformation using Bun.build() + Oxc
 * 
 * Strategy:
 * 1. Bun.build() for ESM → CJS conversion, TypeScript/JSX transformation, and define variables
 * 2. Oxc for type assertion removal and Flow imports (post-processing)
 * 
 * Note: This transformer is used as fallback. The main transformation happens in graph/index.ts
 * using Bun.build() directly for better performance and accurate ESM → CJS conversion.
 */

import type { TransformerConfig } from '../config/types';
import { transformWithBun } from './bun-transformer';
import { removeTypeAssertionsWithOxc, transformWithOxc } from './oxc-transformer';
import { extractDependencies } from './utils';
import type { TransformOptions, TransformResult } from './types';

/**
 * Check if code has type assertions that need to be removed
 */
function hasTypeAssertions(code: string): boolean {
  return /as\s+\w+|satisfies\s+\w+/.test(code);
}

/**
 * Transform source code using Bun.Transpiler + Oxc
 * 
 * 1. Bun.Transpiler handles TypeScript/JSX transformation and define variables
 * 2. Oxc handles type assertion removal, Flow imports, and ESM→CJS conversion
 */
export async function transform(
  options: TransformOptions,
  config: TransformerConfig,
): Promise<TransformResult> {
  // Check if code has ESM imports/exports that need conversion
  const hasESM = /^import\s|^export\s|import\s*\(/.test(options.code);
  
  if (hasESM) {
    // If code has ESM syntax, we need ESM → CJS conversion
    // Bun.Transpiler doesn't do ESM → CJS, so we need to use Bun.build() or handle it manually
    // For now, use Bun.Transpiler first, then manually convert ESM to CJS
    const bunResult = await transformWithBun(options);
    
    // Check if Bun.Transpiler converted ESM to CJS
    if (bunResult.code.includes('import ') || bunResult.code.includes('export ')) {
      // Bun.Transpiler didn't convert, we need to handle it manually
      // For now, throw an error to use Bun.build() path instead
      // This should not happen in normal flow as Bun.build() is used first
      throw new Error(
        `ESM → CJS conversion needed but Bun.Transpiler doesn't support it. Use Bun.build() path instead.`,
      );
    }
    
    // Use Oxc for post-processing (type assertions, Flow imports)
    const finalResult = await removeTypeAssertionsWithOxc(
      bunResult.code,
      options,
    );
    
    return {
      code: finalResult.code,
      dependencies: bunResult.dependencies,
      map: finalResult.map,
    };
  }
  
  // Step 1: Transform with Bun.Transpiler (fast, handles TS/JSX/define)
  const bunResult = await transformWithBun(options);
  
  // Step 2: Use Oxc for post-processing (type assertions, Flow imports)
  // Note: ESM→CJS conversion is not needed if code doesn't have ESM syntax
  const finalResult = await removeTypeAssertionsWithOxc(
    bunResult.code,
    options,
  );
  
  return {
    code: finalResult.code,
    dependencies: bunResult.dependencies, // Use dependencies from original code
    map: finalResult.map,
  };
}

export { transformWithBun } from './bun-transformer';
export { transformWithOxc } from './oxc-transformer';
export { extractDependencies } from './utils';
export * from './types';

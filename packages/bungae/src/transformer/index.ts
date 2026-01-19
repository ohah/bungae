/**
 * Transformer - Unified code transformation pipeline
 *
 * Transformation order:
 * 1-3. Flow Type Stripping (Babel + Hermes) - if Flow detected
 * 4-5. ESM → CJS + JSX Transformation (SWC) - all code
 *
 * Note: This transformer is used as fallback. The main transformation happens in graph/index.ts.
 */

import type { TransformerConfig } from '../config/types';
import { hasFlowSyntax, stripFlowTypesWithBabel, transformWithSwcCore } from './swc-transformer';
import type { TransformOptions, TransformResult } from './types';
import { extractDependencies } from './utils';

/**
 * Transform source code using unified pipeline
 */
export async function transform(
  options: TransformOptions,
  config: TransformerConfig,
): Promise<TransformResult> {
  const { code, filePath, platform, dev } = options;

  let transformedCode = code;

  // Step 1-3: Flow processing (Babel + Hermes) - only if Flow detected
  const hasFlow = await hasFlowSyntax(code, filePath);
  if (hasFlow) {
    transformedCode = await stripFlowTypesWithBabel(transformedCode, filePath);
  }

  // Step 4-5: ESM → CJS + JSX transformation (SWC) with define variables
  transformedCode = await transformWithSwcCore(transformedCode, filePath, {
    dev,
    module: 'commonjs',
    platform,
  });

  // Extract dependencies from original code
  const dependencies = await extractDependencies(code, filePath);

  return {
    code: transformedCode,
    dependencies,
    map: undefined,
  };
}

export { transformWithBun } from './bun-transformer';
export { transformWithSwc } from './swc-transformer';
export { extractDependencies } from './utils';
export * from './types';

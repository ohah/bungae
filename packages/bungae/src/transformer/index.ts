/**
 * Transformer - Code transformation using Bun.Transpiler with optional Babel
 */

import type { TransformerConfig } from '../config/types';
import { transformWithBabel } from './babel-transformer';
import { transformWithBun } from './bun-transformer';
import type { TransformOptions, TransformResult } from './types';
import { shouldUseBabel } from './utils';

/**
 * Transform source code
 */
export async function transform(
  options: TransformOptions,
  config: TransformerConfig,
): Promise<TransformResult> {
  const { filePath } = options;

  // Check if Babel is needed
  if (shouldUseBabel(filePath, config)) {
    return transformWithBabel(options, config);
  }

  // Default: Use Bun transpiler
  return transformWithBun(options);
}

export { transformWithBun } from './bun-transformer';
export { transformWithBabel } from './babel-transformer';
export * from './types';

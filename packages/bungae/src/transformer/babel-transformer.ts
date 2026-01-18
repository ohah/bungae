/**
 * Babel Transformer - Optional Babel transformation for special cases
 */

import type { TransformerConfig } from '../config/types';
import type { TransformOptions, TransformResult } from './types';

/**
 * Transform code using Babel
 * Note: Babel is not installed by default, so this will throw if Babel is needed but not available
 */
export async function transformWithBabel(
  options: TransformOptions,
  config: TransformerConfig,
): Promise<TransformResult> {
  // For Phase 1-3, we'll throw an error if Babel is needed
  // In the future, we can add Babel as an optional dependency
  throw new Error(
    'Babel transformation is not yet implemented. ' +
      'For Phase 1-3, only Bun.Transpiler is supported. ' +
      'Babel support will be added in a future phase.',
  );
}

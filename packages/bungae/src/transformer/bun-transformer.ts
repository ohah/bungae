/**
 * Bun Transformer - Uses Bun.Transpiler for fast code transformation
 */

import type { TransformOptions, TransformResult } from './types';
import { getLoader, extractDependencies } from './utils';

/**
 * Transform code using Bun.Transpiler
 */
export async function transformWithBun(options: TransformOptions): Promise<TransformResult> {
  const { code, filePath, platform, dev } = options;
  const loader = getLoader(filePath);

  const transpiler = new Bun.Transpiler({
    loader,
    // Use 'node' target for better compatibility with vm.runInNewContext
    // Metro bundles are executed in Node.js VM context, so we need ES5-compatible code
    target: 'node',
    define: {
      'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
      __DEV__: String(dev),
      __PLATFORM__: JSON.stringify(platform),
    },
  });

  let transformed: string;
  try {
    transformed = transpiler.transformSync(code);
  } catch {
    // If transformation fails (e.g., Flow syntax), try to handle gracefully
    // For now, return the code as-is (silently, to avoid too many warnings)
    // Flow files and other unsupported syntax will be passed through
    transformed = code;
  }

  // Bun.Transpiler handles TypeScript/JSX transformations and define variables
  // Flow type imports, ESM→CJS conversion, and type assertions are handled by oxc

  // Extract dependencies from original code (before transformation)
  // Use AST-based extraction with oxc for accurate dependency detection
  // For JSX files, oxc-transform is used to transform JSX first, then extract dependencies
  const dependencies = await extractDependencies(code, filePath);

  return {
    code: transformed,
    dependencies,
  };
}

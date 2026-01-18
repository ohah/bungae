/**
 * Bun Transformer - Uses Bun.Transpiler for fast code transformation
 */

import type { TransformOptions, TransformResult } from './types';
import { getLoader } from './utils';

/**
 * Transform code using Bun.Transpiler
 */
export function transformWithBun(options: TransformOptions): TransformResult {
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

  // Extract dependencies (simple regex-based extraction for now)
  // In Phase 2, this will be more sophisticated with AST parsing
  const dependencies = extractDependencies(code);

  return {
    code: transformed,
    dependencies,
  };
}

/**
 * Extract dependencies from source code
 * Simple regex-based extraction (will be improved in Phase 2)
 */
function extractDependencies(code: string): string[] {
  const dependencies: string[] = [];
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  let match;
  while ((match = requireRegex.exec(code)) !== null) {
    if (match[1]) {
      dependencies.push(match[1]);
    }
  }
  while ((match = importRegex.exec(code)) !== null) {
    if (match[1]) {
      dependencies.push(match[1]);
    }
  }
  while ((match = dynamicImportRegex.exec(code)) !== null) {
    if (match[1]) {
      dependencies.push(match[1]);
    }
  }

  // Filter out Flow file imports
  const filtered = dependencies.filter(
    (dep) => !dep.endsWith('.flow') && !dep.endsWith('.flow.js'),
  );

  return [...new Set(filtered)];
}

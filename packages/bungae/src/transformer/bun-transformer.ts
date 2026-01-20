/**
 * Bun Transformer - Uses Bun.Transpiler for fast code transformation
 *
 * NOTE: Currently NOT USED. Using Babel + Hermes Parser instead for Metro compatibility.
 * Kept for future optimization when Flow support is no longer needed.
 * See: graph-bundler.ts for the actual transformation logic.
 */

// import type { TransformOptions, TransformResult } from './types';
// import { getLoader, extractDependencies } from './utils';

// /**
//  * Transform code using Bun.Transpiler
//  *
//  * NOT USED: Currently using Babel + Hermes Parser for Metro compatibility.
//  * This transformer doesn't support Flow syntax which is required for React Native.
//  */
// export async function transformWithBun(options: TransformOptions): Promise<TransformResult> {
//   const { code, filePath, platform, dev } = options;
//   const loader = getLoader(filePath);

//   const transpiler = new Bun.Transpiler({
//     loader,
//     // Use 'node' target for better compatibility with vm.runInNewContext
//     // Metro bundles are executed in Node.js VM context, so we need ES5-compatible code
//     target: 'node',
//     define: {
//       'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
//       __DEV__: String(dev),
//       __PLATFORM__: JSON.stringify(platform),
//     },
//   });

//   const transformed = transpiler.transformSync(code);

//   // Bun.Transpiler handles TypeScript/JSX transformations and define variables
//   // Flow type imports, ESM→CJS conversion, and type assertions are handled by oxc

//   // Extract dependencies from original code (before transformation)
//   // Use AST-based extraction with oxc for accurate dependency detection
//   // For JSX files, oxc-transform is used to transform JSX first, then extract dependencies
//   const dependencies = await extractDependencies(code, filePath);

//   return {
//     code: transformed,
//     dependencies,
//   };
// }

export {}; // Keep module export for TypeScript

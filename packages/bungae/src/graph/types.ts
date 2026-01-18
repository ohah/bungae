/**
 * Graph Types
 */

import type { Module as SerializerModule } from '../serializer/types';

/**
 * Graph module (internal representation)
 */
export interface GraphModule {
  /** Absolute file path */
  path: string;
  /** Transformed code */
  code: string;
  /** Source map (optional) */
  map?: string;
  /** Dependencies (absolute paths) */
  dependencies: string[];
  /** Original dependency paths (as they appear in source code, e.g., "./Bar") */
  originalDependencies: string[];
  /** Whether this module has been processed */
  processed: boolean;
}

/**
 * Graph build options
 */
export interface GraphBuildOptions {
  /** Entry file path (relative to project root) */
  entryFile: string;
  /** Platform */
  platform: 'ios' | 'android' | 'web';
  /** Development mode */
  dev: boolean;
  /** Project root */
  projectRoot: string;
  /** Resolver config */
  resolver: {
    sourceExts: string[];
    assetExts: string[];
    platforms: string[];
    preferNativePlatform: boolean;
    nodeModulesPaths: string[];
  };
  /** Transformer config */
  transformer: {
    babel?: {
      include?: string[];
      plugins?: string[];
      presets?: string[];
    };
    minifier?: 'bun' | 'terser' | 'esbuild';
    inlineRequires?: boolean;
  };
  /** On progress callback */
  onProgress?: (processed: number, total: number) => void;
}

/**
 * Graph build result
 */
export interface GraphBuildResult {
  /** All modules in the graph */
  modules: Map<string, GraphModule>;
  /** Entry module */
  entryModule: GraphModule;
  /** Prepended modules (prelude, metro-runtime, polyfills) */
  prepend: SerializerModule[];
}

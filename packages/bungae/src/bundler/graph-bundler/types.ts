/**
 * Type definitions for Graph Bundler
 */

/**
 * Module in the dependency graph
 */
export interface GraphModule {
  path: string;
  code: string;
  transformedAst: any; // Metro-compatible: transformer returns AST, serializer generates code
  dependencies: string[];
  originalDependencies: string[];
  inverseDependencies?: string[]; // Cached inverse dependencies for efficient HMR
}

/**
 * Asset information for Metro-compatible asset handling
 */
export interface AssetInfo {
  filePath: string;
  httpServerLocation: string;
  name: string;
  type: string;
  width: number;
  height: number;
  scales: number[]; // Metro scales array (e.g., [1] or [1, 2, 3])
}

/**
 * Build result from buildWithGraph
 */
export interface BuildResult {
  code: string;
  map?: string;
  assets?: AssetInfo[];
  // HMR support (dev mode only)
  graph?: Map<string, GraphModule>;
  createModuleId?: (path: string) => number | string;
}

/**
 * HMR Update message (Metro protocol)
 * Metro's generateModules includes sourceMappingURL (optional but recommended)
 */
export interface HMRUpdateMessage {
  type: 'update';
  body: {
    revisionId: string;
    isInitialUpdate: boolean;
    added: Array<{ module: [number, string]; sourceURL: string; sourceMappingURL?: string }>;
    modified: Array<{ module: [number, string]; sourceURL: string; sourceMappingURL?: string }>;
    deleted: number[];
  };
}

/**
 * HMR Error message (Metro protocol)
 */
export interface HMRErrorMessage {
  type: 'error';
  body: {
    type: string;
    message: string;
    stack?: string;
  };
}

/**
 * Delta result for incremental builds
 */
export interface DeltaResult {
  added: Map<string, GraphModule>;
  modified: Map<string, GraphModule>;
  deleted: Set<string>;
}

/**
 * Platform build state for HMR
 */
export interface PlatformBuildState {
  graph: Map<string, GraphModule>;
  moduleIdToPath: Map<number | string, string>;
  pathToModuleId: Map<string, number | string>;
  revisionId: string;
  createModuleId: (path: string) => number | string;
}

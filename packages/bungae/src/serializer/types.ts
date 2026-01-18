/**
 * Serializer Types
 */

export interface Module {
  /** Module path */
  path: string;
  /** Module code */
  code: string;
  /** Dependencies (module paths) */
  dependencies: string[];
  /** Source map (optional) */
  map?: string;
}

export interface Bundle {
  /** Prelude code (variables, metro-runtime, polyfills) */
  pre: string;
  /** Post code (entry execution, source map) */
  post: string;
  /** Modules array: [moduleId, code][] */
  modules: Array<[number | string, string]>;
}

export interface SerializerOptions {
  /** Create module ID from path */
  createModuleId: (path: string) => number | string;
  /** Get run module statement */
  getRunModuleStatement: (moduleId: number | string, globalPrefix: string) => string;
  /** Process module filter */
  processModuleFilter?: (module: Module) => boolean;
  /** Development mode */
  dev: boolean;
  /** Project root */
  projectRoot: string;
  /** Server root */
  serverRoot: string;
  /** Global prefix */
  globalPrefix: string;
  /** Run module */
  runModule: boolean;
  /** Source map URL */
  sourceMapUrl?: string;
  /** Source URL */
  sourceUrl?: string;
  /** Run before main module */
  runBeforeMainModule?: string[];
}

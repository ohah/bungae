/**
 * Serializer Types
 */

/**
 * Module type (Metro-compatible)
 * - 'js/module': Regular JS module (wrapped with __d())
 * - 'js/script': Script module (not wrapped, runs as-is - polyfills, prelude)
 * - 'js/script/virtual': Virtual script module (generated code)
 */
export type ModuleType = 'js/module' | 'js/script' | 'js/script/virtual';

export interface Module {
  /** Module path */
  path: string;
  /** Module code */
  code: string;
  /** Dependencies (module paths - absolute) */
  dependencies: string[];
  /** Original dependency paths (as they appear in source code, e.g., "./Bar") */
  originalDependencies?: string[];
  /** Source map (optional) */
  map?: string;
  /** Module type (Metro-compatible) - defaults to 'js/module' if not specified */
  type?: ModuleType;
}

export interface Bundle {
  /** Prelude code (variables, metro-runtime, polyfills) */
  pre: string;
  /** Post code (entry execution, source map) */
  post: string;
  /** Modules array: [moduleId, code][] */
  modules: Array<[number | string, string]>;
  /** Processed prepend modules with transformed code and source map (for source map generation) */
  processedPreModules?: ReadonlyArray<[Module, string, any | null]>;
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
  /** Inline source map (base64 encoded in bundle) */
  inlineSourceMap?: boolean;
  /** Should add module to ignore list (for x_google_ignoreList) */
  shouldAddToIgnoreList?: (module: Module) => boolean;
  /** Include async paths in dependency map */
  includeAsyncPaths?: boolean;
  /** Modules only (skip prelude and runtime) */
  modulesOnly?: boolean;
  /** Async require module path */
  asyncRequireModulePath?: string;
  /** Get source URL for module */
  getSourceUrl?: (module: Module) => string;
}

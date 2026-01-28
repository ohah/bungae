/**
 * Tree Shaking Types
 *
 * Type definitions for tree shaking functionality
 */

/**
 * Export information extracted from AST
 */
export interface ExportInfo {
  /** Export name (for named exports) */
  name: string;
  /** Whether this is a default export */
  isDefault: boolean;
  /** Whether this is a re-export from another module */
  isReExport: boolean;
  /** Source module path for re-exports */
  sourceModule?: string;
  /** Local name (for re-exports with renaming) */
  localName?: string;
}

/**
 * Import information extracted from AST
 */
export interface ImportInfo {
  /** Import name (for named imports) */
  name: string;
  /** Whether this is a default import */
  isDefault: boolean;
  /** Whether this is a namespace import (import * as X) */
  isNamespace: boolean;
  /** Source module path */
  sourceModule: string;
  /** Local name (for imports with renaming) */
  localName?: string;
}

/**
 * Track which exports are actually used
 */
export interface UsedExports {
  /** Set of used export names (including 'default') */
  used: Set<string>;
  /** Whether all exports are used (namespace import) */
  allUsed: boolean;
}

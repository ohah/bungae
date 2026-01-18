/**
 * Transformer Types
 */

export interface TransformOptions {
  /** File path */
  filePath: string;
  /** Source code */
  code: string;
  /** Platform */
  platform: 'ios' | 'android' | 'web';
  /** Development mode */
  dev: boolean;
  /** Project root */
  projectRoot: string;
}

export interface TransformResult {
  /** Transformed code */
  code: string;
  /** Source map (optional) */
  map?: string;
  /** Dependencies */
  dependencies: string[];
}

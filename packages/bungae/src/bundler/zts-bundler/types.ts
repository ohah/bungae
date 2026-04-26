/**
 * Type definitions for ZTS Bundler
 */

/**
 * Asset information for Metro-compatible asset handling.
 */
export interface AssetInfo {
  filePath: string;
  httpServerLocation: string;
  name: string;
  type: string;
  width: number;
  height: number;
  scales: number[];
}

/**
 * Build result from buildWithZts.
 */
export interface BuildResult {
  code: string;
  map?: string;
  assets?: AssetInfo[];
}

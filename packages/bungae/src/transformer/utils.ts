/**
 * Transformer Utilities
 */

import { minimatch } from 'minimatch';

import type { TransformerConfig } from '../config/types';

/**
 * Check if Babel should be used for this file
 */
export function shouldUseBabel(filePath: string, config: TransformerConfig): boolean {
  const { babel } = config;
  if (!babel || !babel.include || babel.include.length === 0) {
    return false;
  }

  return babel.include.some((pattern) => minimatch(filePath, pattern));
}

/**
 * Get loader from file extension
 */
export function getLoader(filePath: string): 'tsx' | 'ts' | 'jsx' | 'js' {
  if (filePath.endsWith('.tsx')) return 'tsx';
  if (filePath.endsWith('.ts')) return 'ts';
  if (filePath.endsWith('.jsx')) return 'jsx';
  return 'js';
}

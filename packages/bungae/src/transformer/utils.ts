/**
 * Transformer Utilities
 * Using Babel + Hermes for Flow, SWC for parsing
 */

/**
 * Get loader from file extension
 */
export function getLoader(filePath: string): 'tsx' | 'ts' | 'jsx' | 'js' {
  if (filePath.endsWith('.tsx')) return 'tsx';
  if (filePath.endsWith('.ts')) return 'ts';
  if (filePath.endsWith('.jsx')) return 'jsx';
  return 'js';
}

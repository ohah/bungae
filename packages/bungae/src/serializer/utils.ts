/**
 * Serializer Utilities - Metro-compatible helper functions
 */

/**
 * Create module ID factory (Metro-compatible)
 * Returns a function that assigns unique numeric IDs to module paths
 */
export function createModuleIdFactory(): (path: string) => number {
  const fileToIdMap: Map<string, number> = new Map();
  let nextId = 0;
  return (path: string) => {
    let id = fileToIdMap.get(path);
    if (typeof id !== 'number') {
      id = nextId++;
      fileToIdMap.set(path, id);
    }
    return id;
  };
}

/**
 * Get default run module statement (Metro-compatible)
 * Returns the default statement to execute a module
 *
 * Note: Metro's metro-runtime sets up:
 * - global.__r = metroRequire (always, no prefix)
 * - global[`${__METRO_GLOBAL_PREFIX__}__d`] = define (with prefix)
 *
 * So __r() always uses no prefix, but __d() uses the prefix.
 *
 * @param moduleId - Module ID to require
 * @param globalPrefix - Global prefix (ignored for __r, but kept for API compatibility)
 * @returns Run module statement
 */
export function getRunModuleStatement(
  moduleId: number | string,
  _globalPrefix: string = '',
): string {
  // __r() always uses no prefix, regardless of globalPrefix
  // Only __d() uses the prefix
  // globalPrefix parameter is kept for API compatibility but not used
  return `__r(${JSON.stringify(moduleId)});`;
}

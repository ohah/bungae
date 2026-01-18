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
 */
export function getRunModuleStatement(
  moduleId: number | string,
  globalPrefix: string = '',
): string {
  return `${globalPrefix}__r(${JSON.stringify(moduleId)});`;
}

/**
 * Convert require paths to dependencyMap lookups
 * Metro format: require("./Bar") → require(dependencyMap[0])
 *
 * This converts CommonJS require() calls to use dependencyMap indices
 * instead of string paths, matching Metro's transformer behavior.
 */

/**
 * Convert require paths in code to dependencyMap lookups
 * @param code - Module code with require() calls
 * @param dependencies - Array of dependency paths (in order)
 * @param requireParamName - Name of require parameter (default: 'require')
 * @param dependencyMapParamName - Name of dependencyMap parameter (default: 'dependencyMap')
 * @returns Code with require paths converted to dependencyMap lookups
 */
export function convertRequirePaths(
  code: string,
  dependencies: string[],
  requireParamName: string = 'require',
  dependencyMapParamName: string = 'dependencyMap',
): string {
  if (dependencies.length === 0) {
    return code;
  }

  // Create a map from dependency path to index
  const dependencyIndexMap = new Map<string, number>();
  dependencies.forEach((dep, index) => {
    dependencyIndexMap.set(dep, index);
  });

  // Replace require("path") with require(dependencyMap[index])
  // Handle both single and double quotes
  // Pattern: require("path") or require('path')
  let converted = code;

  // Match require("path") or require('path')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  converted = converted.replace(requireRegex, (match, path) => {
    // Find the index of this dependency
    const index = dependencyIndexMap.get(path);

    if (index !== undefined) {
      // Replace with dependencyMap[index]
      return `${requireParamName}(${dependencyMapParamName}[${index}])`;
    }

    // If path not found in dependencies, keep original (should not happen)
    return match;
  });

  return converted;
}

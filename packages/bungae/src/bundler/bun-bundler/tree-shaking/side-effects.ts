/**
 * Side Effects Detection
 *
 * Checks if a module has side effects by reading package.json sideEffects field
 */

/**
 * Cache for hasSideEffects results to avoid repeated file I/O
 */
const sideEffectsCache = new Map<string, boolean>();

/**
 * Check if a module has side effects
 * Reads package.json to check sideEffects field
 * Results are cached to avoid repeated file I/O
 */
export async function hasSideEffects(modulePath: string): Promise<boolean> {
  // Check cache first
  if (sideEffectsCache.has(modulePath)) {
    return sideEffectsCache.get(modulePath)!;
  }

  let result: boolean;
  try {
    const { readFileSync, existsSync } = await import('fs');
    const { dirname, join, relative, parse } = await import('path');

    // Find package.json by traversing up from module path
    let currentDir = dirname(modulePath);
    // Use path.parse().root for cross-platform root detection
    const root = parse(modulePath).root;

    while (currentDir !== root && currentDir !== dirname(currentDir)) {
      const packageJsonPath = join(currentDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          const sideEffects = packageJson.sideEffects;

          // If sideEffects is false, no side effects
          if (sideEffects === false) {
            result = false;
            sideEffectsCache.set(modulePath, result);
            return result;
          }

          // If sideEffects is an array, check if this file matches
          if (Array.isArray(sideEffects)) {
            // Use path.relative for cross-platform path handling
            const relativePath = relative(currentDir, modulePath).replace(/\\/g, '/');
            const hasMatch = sideEffects.some((pattern: string) => {
              // Improved glob pattern matching
              // Escape dots first, then replace wildcards
              let regexPattern = pattern
                .replace(/\./g, '\\.') // Escape dots
                .replace(/\*\*/g, '.*') // ** matches any path
                .replace(/\*/g, '[^/]*'); // * matches any non-slash characters

              // Add anchors for exact matching
              regexPattern = `^${regexPattern}$`;

              // Handle Windows path separators
              const normalizedRelativePath = relativePath.replace(/\\/g, '/');
              const regex = new RegExp(regexPattern);
              return regex.test(normalizedRelativePath) || regex.test(relativePath);
            });
            result = hasMatch; // If matches, has side effects
            sideEffectsCache.set(modulePath, result);
            return result;
          }

          // Default: assume side effects exist (safe default)
          result = true;
          sideEffectsCache.set(modulePath, result);
          return result;
        } catch {
          // Invalid JSON, assume side effects
          result = true;
          sideEffectsCache.set(modulePath, result);
          return result;
        }
      }
      currentDir = dirname(currentDir);
    }

    // No package.json found, assume side effects (safe default)
    result = true;
    sideEffectsCache.set(modulePath, result);
    return result;
  } catch {
    // Error reading, assume side effects (safe default)
    result = true;
    sideEffectsCache.set(modulePath, result);
    return result;
  }
}

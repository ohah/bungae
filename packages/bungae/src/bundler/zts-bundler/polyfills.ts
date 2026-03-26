/**
 * Polyfill Resolution for ZTS Bundler
 *
 * Resolves paths to React Native polyfill modules that must be
 * loaded before the main entry point.
 */

/**
 * Resolve polyfill module paths from node_modules.
 * These modules are prepended to the bundle in order.
 */
export function resolvePolyfillPaths(projectRoot: string): string[] {
  const paths: string[] = [];

  const candidates = [
    'react-native/Libraries/Core/InitializeCore.js',
    'react-native/Libraries/Core/setUpGlobals.js',
    'react-native/Libraries/Core/setUpDeveloperTools.js',
  ];

  for (const candidate of candidates) {
    try {
      const resolved = require.resolve(candidate, { paths: [projectRoot] });
      paths.push(resolved);
    } catch {
      // Module not found — skip
    }
  }

  return paths;
}

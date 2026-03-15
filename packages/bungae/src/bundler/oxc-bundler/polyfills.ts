/**
 * React Native Polyfill Resolution
 *
 * Resolves polyfill file paths from rn-get-polyfills (console.js, error-guard.js, etc.).
 * These polyfills must execute before any app code to set up the RN runtime environment.
 *
 * Previously injected via Rolldown's `intro` option (no source maps).
 * Now resolved as import paths for the prelude plugin to inject as proper modules.
 */

let cachedPolyfillPaths: string[] | null = null;

/**
 * Resolve React Native polyfill file paths.
 * Returns absolute paths to polyfill files (e.g., console.js, error-guard.js).
 * Results are cached since polyfill paths don't change during a session.
 */
export function resolvePolyfillPaths(projectRoot: string): string[] {
  if (cachedPolyfillPaths !== null) return cachedPolyfillPaths;

  try {
    const rnGetPolyfills = require(
      require.resolve('react-native/rn-get-polyfills', { paths: [projectRoot] }),
    ) as () => string[];
    cachedPolyfillPaths = rnGetPolyfills();
  } catch {
    cachedPolyfillPaths = [];
  }

  return cachedPolyfillPaths;
}

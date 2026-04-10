/**
 * Shared RN constants and helpers used by both process.ts (subprocess) and napi-build.ts (NAPI).
 */

/**
 * require.resolve with fallback — returns null if not found.
 */
export function tryResolve(specifier: string, fromDir: string): string | null {
  try {
    return require.resolve(specifier, { paths: [fromDir] });
  } catch {
    return null;
  }
}

/**
 * Resolve RN polyfill paths (console.js, error-guard.js).
 * Tries rn-get-polyfills first (RN 0.73+), falls back to @react-native/js-polyfills.
 */
export function resolveRnPolyfills(projectRoot: string): string[] {
  const candidates = ['react-native/rn-get-polyfills', '@react-native/js-polyfills'];
  for (const candidate of candidates) {
    const resolved = tryResolve(candidate, projectRoot);
    if (resolved) {
      try {
        return (require(resolved) as () => string[])();
      } catch {
        continue;
      }
    }
  }
  console.warn('[zts] Could not resolve RN polyfills, skipping');
  return [];
}

/**
 * RN reserved global identifiers (RN 0.83).
 * Registered via polyfillGlobal() — scope hoisting must avoid shadowing these.
 */
export const RN_GLOBAL_IDENTIFIERS = [
  // polyfillPromise
  'Promise',
  // setUpRegeneratorRuntime
  'regeneratorRuntime',
  // setUpXHR
  'XMLHttpRequest',
  'FormData',
  'fetch',
  'Headers',
  'Request',
  'Response',
  'WebSocket',
  'Blob',
  'File',
  'FileReader',
  'URL',
  'URLSearchParams',
  'AbortController',
  'AbortSignal',
  // setUpTimers
  'queueMicrotask',
  'setImmediate',
  'clearImmediate',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  // setUpDOM
  'DOMRect',
  'DOMRectReadOnly',
  'DOMRectList',
  'HTMLCollection',
  'NodeList',
  'Node',
  'Document',
  'CharacterData',
  'Text',
  'Element',
  'HTMLElement',
  // setUpIntersectionObserver
  'IntersectionObserver',
  // setUpMutationObserver
  'MutationObserver',
  'MutationRecord',
  // setUpPerformanceModern
  'EventCounts',
  'Performance',
  'PerformanceEntry',
  'PerformanceEventTiming',
  'PerformanceLongTaskTiming',
  'PerformanceMark',
  'PerformanceMeasure',
  'PerformanceObserver',
  'PerformanceObserverEntryList',
  'PerformanceResourceTiming',
  'TaskAttributionTiming',
];

/**
 * React Refresh utilities for HMR
 *
 * Provides utilities for React component hot reloading.
 * Used by the HMR runtime to determine if a module is a React component
 * and to enqueue React Refresh updates.
 */

declare global {
  var __ReactRefresh: any;
}

let pendingUpdates = 0;
let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Check if a module's exports constitute a React Refresh boundary.
 * A boundary is a module that only exports React components.
 */
export function isReactRefreshBoundary(moduleExports: Record<string, any>): boolean {
  const ReactRefresh = globalThis.__ReactRefresh;
  if (!ReactRefresh) return false;

  // Check if it's a function component
  if (typeof moduleExports === 'function') {
    return ReactRefresh.isLikelyComponentType(moduleExports);
  }

  // Check if all named exports are components
  if (typeof moduleExports === 'object' && moduleExports !== null) {
    const hasDefaultExport = 'default' in moduleExports;
    let hasNonComponentExport = false;

    for (const key of Object.keys(moduleExports)) {
      if (key === '__esModule') continue;
      const val = moduleExports[key];
      if (typeof val === 'function' && !ReactRefresh.isLikelyComponentType(val)) {
        hasNonComponentExport = true;
      }
    }

    // If it has a default export that is a component, and no non-component named exports
    if (hasDefaultExport && !hasNonComponentExport) {
      return true;
    }
  }

  return false;
}

/**
 * Enqueue a React Refresh update.
 * Debounces multiple updates to avoid unnecessary re-renders.
 */
export function enqueueUpdate(): void {
  pendingUpdates++;

  if (refreshTimeout != null) {
    clearTimeout(refreshTimeout);
  }

  refreshTimeout = setTimeout(() => {
    refreshTimeout = null;
    const updates = pendingUpdates;
    pendingUpdates = 0;

    if (updates > 0) {
      performReactRefresh();
    }
  }, 50);
}

function performReactRefresh(): void {
  const ReactRefresh = globalThis.__ReactRefresh;
  if (!ReactRefresh) return;

  try {
    ReactRefresh.performReactRefresh();
  } catch (error) {
    console.error('[HMR] React Refresh failed:', error);
  }
}

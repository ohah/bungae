/**
 * React Refresh Plugin for Rolldown
 *
 * Wraps React component modules with `import.meta.hot.accept()` boundaries
 * for Fast Refresh support. When a component file changes, the DevEngine
 * sends a patch update instead of a full reload, preserving component state.
 *
 * Two-phase approach (same as Rollipop):
 * 1. Transform: Inject $RefreshReg$ / $RefreshSig$ markers via Rolldown's transformSync
 * 2. Boundary: Wrap modules with import.meta.hot.accept() for HMR boundary detection
 */

import MagicString from 'magic-string';
import type { Plugin } from 'rolldown';
import { transformSync } from 'rolldown/experimental';

const INCLUDE_REGEX = /\.[tj]sx?(?:$|\?)/;
const EXCLUDE_REGEX = /\/node_modules\//;

const HAS_REFRESH_REGEX = /\$RefreshReg\$\(/;

/**
 * Creates a pair of Rolldown plugins for React Refresh support.
 *
 * Plugin 1 (transform): Uses Rolldown's built-in JSX refresh transform
 * to inject $RefreshReg$ and $RefreshSig$ calls.
 *
 * Plugin 2 (boundary): Wraps modules containing refresh markers with
 * import.meta.hot.accept() callback that triggers React Refresh.
 */
export function reactRefreshPlugin(): Plugin[] {
  const reactRefreshTransform: Plugin = {
    name: 'bungae:transform-react-refresh',
    transform: {
      filter: {
        id: {
          include: [INCLUDE_REGEX],
          exclude: [EXCLUDE_REGEX],
        },
      },
      handler(code, id) {
        const result = transformSync(id, code, {
          sourcemap: true,
          jsx: {
            runtime: 'automatic',
            development: true,
            refresh: {
              refreshReg: 'globalThis.$RefreshReg$',
              refreshSig: 'globalThis.$RefreshSig$',
            },
          },
        });

        return { code: result.code, map: result.map };
      },
    },
  };

  const reactRefreshBoundary: Plugin = {
    name: 'bungae:react-refresh-boundary',
    transform: {
      filter: {
        id: {
          include: [INCLUDE_REGEX],
          exclude: [EXCLUDE_REGEX],
        },
      },
      handler(code, id) {
        const hasRefresh = HAS_REFRESH_REGEX.test(code);
        if (!hasRefresh) return;

        const { code: wrappedCode, map } = wrapWithRefreshBoundary(code, id);
        return { code: wrappedCode, map };
      },
    },
  };

  return [reactRefreshTransform, reactRefreshBoundary];
}

function wrapWithRefreshBoundary(
  code: string,
  id: string,
): { code: string; map: string } {
  const prependCode = `
var __prev$RefreshReg$ = globalThis.$RefreshReg$;
var __prev$RefreshSig$ = globalThis.$RefreshSig$;
globalThis.$RefreshReg$ = function(type, id) { if (globalThis.__ReactRefresh) globalThis.__ReactRefresh.register(type, ${JSON.stringify(id)} + ' ' + id); }
globalThis.$RefreshSig$ = function() { if (globalThis.__ReactRefresh) return globalThis.__ReactRefresh.createSignatureFunctionForTransform(); return function(type) { return type; }; }
`;

  const appendCode = `
if (import.meta.hot) {
  if (import.meta.hot.refresh == null) throw new Error('react-refresh runtime is not initialized');
  import.meta.hot.accept(function(nextExports) {
    if (!nextExports) return;
    if (import.meta.hot.refreshUtils.isReactRefreshBoundary(nextExports)) {
      import.meta.hot.refreshUtils.enqueueUpdate();
    }
  });
}
globalThis.$RefreshReg$ = __prev$RefreshReg$;
globalThis.$RefreshSig$ = __prev$RefreshSig$;
`;

  const s = new MagicString(code);
  s.prepend(prependCode);
  s.append(appendCode);

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: id }).toString(),
  };
}

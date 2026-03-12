import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { isReactRefreshBoundary, enqueueUpdate } from '../../hmr/react-refresh-utils';

describe('isReactRefreshBoundary', () => {
  beforeEach(() => {
    // Mock __ReactRefresh
    globalThis.__ReactRefresh = {
      isLikelyComponentType: (type: any) => {
        // Simple heuristic: function name starts with uppercase
        if (typeof type !== 'function') return false;
        return /^[A-Z]/.test(type.name || '');
      },
    };
  });

  afterEach(() => {
    globalThis.__ReactRefresh = undefined;
  });

  it('should return true for function components', () => {
    function MyComponent() {
      return null;
    }
    expect(isReactRefreshBoundary(MyComponent as any)).toBe(true);
  });

  it('should return false for non-component functions', () => {
    function helper() {
      return 42;
    }
    expect(isReactRefreshBoundary(helper as any)).toBe(false);
  });

  it('should return true for default export component modules', () => {
    function App() {
      return null;
    }
    const moduleExports = { default: App, __esModule: true };
    expect(isReactRefreshBoundary(moduleExports)).toBe(true);
  });

  it('should return false when __ReactRefresh is not available', () => {
    globalThis.__ReactRefresh = undefined;
    function App() {
      return null;
    }
    expect(isReactRefreshBoundary(App as any)).toBe(false);
  });
});

describe('enqueueUpdate', () => {
  beforeEach(() => {
    globalThis.__ReactRefresh = {
      performReactRefresh: () => {
        // no-op for tests
      },
    };
  });

  afterEach(() => {
    globalThis.__ReactRefresh = undefined;
  });

  it('should debounce updates', async () => {
    // Call multiple times rapidly
    enqueueUpdate();
    enqueueUpdate();
    enqueueUpdate();

    // Should not throw
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
});

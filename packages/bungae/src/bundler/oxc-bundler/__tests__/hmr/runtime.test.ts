import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

import { transformSync } from 'rolldown/experimental';

describe('HMR Runtime', () => {
  it('should export a valid TypeScript source file', () => {
    const source = readFileSync(require.resolve('../../hmr/runtime'), 'utf-8');
    expect(source).toContain('__rolldown_runtime__');
    expect(source).toContain('globalThis.__rolldown_runtime__');
  });

  it('should contain React Refresh utilities inline', () => {
    const source = readFileSync(require.resolve('../../hmr/runtime'), 'utf-8');
    expect(source).toContain('isReactRefreshBoundary');
    expect(source).toContain('enqueueUpdate');
    expect(source).toContain('__ReactRefresh');
    expect(source).toContain('performReactRefresh');
  });

  it('should implement module hot context with refreshUtils getter', () => {
    const source = readFileSync(require.resolve('../../hmr/runtime'), 'utf-8');
    expect(source).toContain('createModuleHotCtx');
    expect(source).toContain('refreshUtils');
    expect(source).toContain('accept');
    expect(source).toContain('invalidate');
    expect(source).toContain('cleanup');
  });

  it('should handle HMR message types in runtime', () => {
    const source = readFileSync(require.resolve('../../hmr/runtime'), 'utf-8');
    expect(source).toContain("'hmr:update'");
    expect(source).toContain("'hmr:reload'");
    expect(source).toContain("'hmr:error'");
  });

  it('should support globalEvalWithSourceUrl for DevTools', () => {
    const source = readFileSync(require.resolve('../../hmr/runtime'), 'utf-8');
    expect(source).toContain('globalEvalWithSourceUrl');
  });

  it('should be compilable with Rolldown transformSync', () => {
    const source = readFileSync(require.resolve('../../hmr/runtime'), 'utf-8');

    const result = transformSync('runtime.ts', source, { sourcemap: false });
    expect(result.code).toBeTruthy();
    // TypeScript annotations should be stripped
    expect(result.code).not.toContain(': string');
    // Runtime object should still exist
    expect(result.code).toContain('__rolldown_runtime__');
  });
});

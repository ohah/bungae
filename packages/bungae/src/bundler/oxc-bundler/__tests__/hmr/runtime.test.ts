import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('HMR Runtime', () => {
  it('should export a valid TypeScript source file', () => {
    const source = readFileSync(
      require.resolve('../../hmr/runtime'),
      'utf-8',
    );
    expect(source).toContain('class ReactNativeDevRuntime');
    expect(source).toContain('extends BaseDevRuntime');
    expect(source).toContain('globalThis.__rolldown_runtime__');
  });

  it('should contain React Refresh utilities inline', () => {
    const source = readFileSync(
      require.resolve('../../hmr/runtime'),
      'utf-8',
    );
    expect(source).toContain('isReactRefreshBoundary');
    expect(source).toContain('enqueueUpdate');
    expect(source).toContain('__ReactRefresh');
    expect(source).toContain('performReactRefresh');
  });

  it('should implement ModuleHotContext with refreshUtils getter', () => {
    const source = readFileSync(
      require.resolve('../../hmr/runtime'),
      'utf-8',
    );
    expect(source).toContain('class ModuleHotContext');
    expect(source).toContain('get refreshUtils()');
    expect(source).toContain('get refresh()');
    expect(source).toContain('accept(');
    expect(source).toContain('invalidate()');
    expect(source).toContain('cleanup()');
  });

  it('should handle HMR message types in runtime', () => {
    const source = readFileSync(
      require.resolve('../../hmr/runtime'),
      'utf-8',
    );
    expect(source).toContain("'hmr:update'");
    expect(source).toContain("'hmr:reload'");
    expect(source).toContain("'hmr:error'");
  });

  it('should support globalEvalWithSourceUrl for DevTools', () => {
    const source = readFileSync(
      require.resolve('../../hmr/runtime'),
      'utf-8',
    );
    expect(source).toContain('globalEvalWithSourceUrl');
  });

  it('should be compilable with Bun.Transpiler', () => {
    const source = readFileSync(
      require.resolve('../../hmr/runtime'),
      'utf-8',
    );
    const transpiler = new Bun.Transpiler({
      loader: 'ts',
      target: 'browser',
    });

    const result = transpiler.transformSync(source);
    expect(result).toBeTruthy();
    // TypeScript annotations should be stripped
    expect(result).not.toContain(': string');
    // Class should still exist
    expect(result).toContain('ReactNativeDevRuntime');
  });
});

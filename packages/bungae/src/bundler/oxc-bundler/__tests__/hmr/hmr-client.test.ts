import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('HMR Client', () => {
  it('should export a valid TypeScript source file', () => {
    const source = readFileSync(
      require.resolve('../../hmr/hmr-client'),
      'utf-8',
    );
    expect(source).toContain('class HMRClient');
    expect(source).toContain('implements HMRClientNativeInterface');
    expect(source).toContain('export default');
  });

  it('should implement the HMRClientNativeInterface methods', () => {
    const source = readFileSync(
      require.resolve('../../hmr/hmr-client'),
      'utf-8',
    );
    expect(source).toContain('enable()');
    expect(source).toContain('disable()');
    expect(source).toContain('registerBundle(');
    expect(source).toContain('log(');
    expect(source).toContain('setup(');
  });

  it('should handle HMR message types', () => {
    const source = readFileSync(
      require.resolve('../../hmr/hmr-client'),
      'utf-8',
    );
    expect(source).toContain("'hmr:update-start'");
    expect(source).toContain("'hmr:update'");
    expect(source).toContain("'hmr:update-done'");
    expect(source).toContain("'hmr:error'");
    expect(source).toContain("'hmr:reload'");
    expect(source).toContain("'hmr:connected'");
  });

  it('should connect __rolldown_runtime__ in setup', () => {
    const source = readFileSync(
      require.resolve('../../hmr/hmr-client'),
      'utf-8',
    );
    expect(source).toContain('__rolldown_runtime__');
    expect(source).toContain('.setup(socket, origin)');
  });

  it('should be compilable with Bun.Transpiler', () => {
    const source = readFileSync(
      require.resolve('../../hmr/hmr-client'),
      'utf-8',
    );
    const transpiler = new Bun.Transpiler({
      loader: 'ts',
      target: 'browser',
    });

    const result = transpiler.transformSync(source);
    expect(result).toBeTruthy();
    expect(result).not.toContain(': string');
    expect(result).not.toContain(': number');
    // Should still have the class logic
    expect(result).toContain('HMRClient');
  });
});

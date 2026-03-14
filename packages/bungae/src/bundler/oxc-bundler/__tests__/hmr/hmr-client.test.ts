import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

import { transformSync } from 'rolldown/experimental';

describe('HMR Client', () => {
  it('should export a valid TypeScript source file', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');
    expect(source).toContain('class HMRClient');
    expect(source).toContain('implements HMRClientNativeInterface');
    expect(source).toContain('export default');
  });

  it('should implement the HMRClientNativeInterface methods', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');
    expect(source).toContain('enable()');
    expect(source).toContain('disable()');
    expect(source).toContain('registerBundle(');
    expect(source).toContain('log(');
    expect(source).toContain('setup(');
  });

  it('should handle HMR message types', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');
    expect(source).toContain("'hmr:update-start'");
    expect(source).toContain("'hmr:update'");
    expect(source).toContain("'hmr:update-done'");
    expect(source).toContain("'hmr:error'");
    expect(source).toContain("'hmr:reload'");
    expect(source).toContain("'hmr:connected'");
  });

  it('should connect __rolldown_runtime__ in setup', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');
    expect(source).toContain('__rolldown_runtime__');
    expect(source).toContain('.setup(socket, origin)');
  });

  it('should be compilable with Rolldown transformSync', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');

    const result = transformSync('hmr-client.ts', source, { sourcemap: false });
    expect(result.code).toBeTruthy();
    expect(result.code).not.toContain(': string');
    expect(result.code).not.toContain(': number');
    // Should still have the class logic
    expect(result.code).toContain('HMRClient');
  });
});

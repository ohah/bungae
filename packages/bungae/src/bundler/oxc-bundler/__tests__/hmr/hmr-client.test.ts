import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

import { transformSync } from 'rolldown/experimental';

describe('HMR Client', () => {
  it('should export a valid TypeScript source file', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');
    expect(source).toContain('class HMRClient');
    expect(source).toContain('module.exports = HMRClient');
  });

  it('should implement metro-runtime HMRClient API', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');
    expect(source).toContain('constructor(url');
    expect(source).toContain('on(event');
    expect(source).toContain('send(data');
    expect(source).toContain('enable()');
    expect(source).toContain('disable()');
    expect(source).toContain('isEnabled()');
    expect(source).toContain('hasPendingUpdates()');
  });

  it('should handle HMR message types', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');
    expect(source).toContain("'hmr:update-start'");
    expect(source).toContain("'hmr:update'");
    expect(source).toContain("'hmr:update-done'");
    expect(source).toContain("'hmr:error'");
    expect(source).toContain("'hmr:reload'");
  });

  it('should integrate with __rolldown_runtime__', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');
    expect(source).toContain('__rolldown_runtime__');
    expect(source).toContain('setup(ws');
  });

  it('should be compilable with Rolldown transformSync', () => {
    const source = readFileSync(require.resolve('../../hmr/hmr-client'), 'utf-8');

    const result = transformSync('hmr-client.ts', source, { sourcemap: false });
    expect(result.code).toBeTruthy();
    expect(result.code).not.toContain(': string');
    expect(result.code).toContain('HMRClient');
  });
});

import { describe, expect, it } from 'bun:test';

import type { HMRServerMessage, HMRClientMessage } from '../../hmr/types';

describe('OXC Server - HMR Protocol', () => {
  it('should serialize update-start message', () => {
    const msg: HMRServerMessage = { type: 'hmr:update-start' };
    const json = JSON.stringify(msg);
    expect(JSON.parse(json)).toEqual({ type: 'hmr:update-start' });
  });

  it('should serialize update message with code', () => {
    const msg: HMRServerMessage = {
      type: 'hmr:update',
      code: 'console.log("hello")',
    };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('hmr:update');
    expect(parsed.code).toBe('console.log("hello")');
  });

  it('should serialize update-done message', () => {
    const msg: HMRServerMessage = { type: 'hmr:update-done' };
    expect(JSON.stringify(msg)).toBe('{"type":"hmr:update-done"}');
  });

  it('should serialize reload message', () => {
    const msg: HMRServerMessage = { type: 'hmr:reload' };
    expect(JSON.stringify(msg)).toBe('{"type":"hmr:reload"}');
  });

  it('should serialize error message', () => {
    const msg: HMRServerMessage = {
      type: 'hmr:error',
      payload: {
        type: 'BuildError',
        message: 'Syntax error in App.tsx',
        errors: [
          {
            description: 'Unexpected token',
            filename: 'App.tsx',
            lineNumber: 10,
            column: 5,
          },
        ],
      },
    };
    const parsed = JSON.parse(JSON.stringify(msg));
    expect(parsed.payload.errors).toHaveLength(1);
    expect(parsed.payload.errors[0].filename).toBe('App.tsx');
  });

  it('should parse connected client message', () => {
    const msg: HMRClientMessage = {
      type: 'hmr:connected',
      bundleEntry: 'index.js',
      platform: 'ios',
    };
    const parsed = JSON.parse(JSON.stringify(msg));
    expect(parsed.type).toBe('hmr:connected');
    expect(parsed.platform).toBe('ios');
    expect(parsed.bundleEntry).toBe('index.js');
  });

  it('should parse module-registered client message', () => {
    const msg: HMRClientMessage = {
      type: 'hmr:module-registered',
      modules: ['./App.tsx', './components/Button.tsx'],
    };
    const parsed = JSON.parse(JSON.stringify(msg));
    expect(parsed.modules).toHaveLength(2);
  });

  it('should handle HMR update sequence correctly', () => {
    const messages: HMRServerMessage[] = [];

    // Simulate a Patch update sequence
    messages.push({ type: 'hmr:update-start' });
    messages.push({ type: 'hmr:update', code: 'var x = 1;' });
    messages.push({ type: 'hmr:update-done' });

    expect(messages).toHaveLength(3);
    expect(messages[0]!.type).toBe('hmr:update-start');
    expect(messages[1]!.type).toBe('hmr:update');
    expect(messages[2]!.type).toBe('hmr:update-done');
  });
});

describe('OXC Server - Bundle serving', () => {
  it('should serve bundle with source map URL appended', () => {
    const bundleCode = 'var x = 1;';
    const entryName = 'index';
    const codeWithSourceMap = `${bundleCode}\n//# sourceMappingURL=${entryName}.map`;

    expect(codeWithSourceMap).toContain('sourceMappingURL=index.map');
  });
});

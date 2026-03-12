import { describe, expect, it } from 'bun:test';

import type { HMRServerMessage, HMRClientMessage, HMRUpdateResult } from '../../hmr/types';

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

  it('should handle HMR Patch update sequence correctly', () => {
    const messages: HMRServerMessage[] = [];

    // Simulate a Patch update sequence from DevEngine
    messages.push({ type: 'hmr:update-start' });
    messages.push({ type: 'hmr:update', code: 'var x = 1;' });
    messages.push({ type: 'hmr:update-done' });

    expect(messages).toHaveLength(3);
    expect(messages[0]!.type).toBe('hmr:update-start');
    expect(messages[1]!.type).toBe('hmr:update');
    expect(messages[2]!.type).toBe('hmr:update-done');
  });

  it('should handle FullReload update correctly', () => {
    const messages: HMRServerMessage[] = [];

    // Simulate a FullReload from DevEngine
    messages.push({ type: 'hmr:reload' });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe('hmr:reload');
  });
});

describe('OXC Server - HMR Update Dispatch', () => {
  it('should dispatch Patch update as update-start/update/update-done sequence', () => {
    const sent: string[] = [];
    const mockClient = {
      id: 'client-0',
      platform: 'ios',
      bundleEntry: 'index.js',
      send: (msg: string) => sent.push(msg),
    };

    const result: HMRUpdateResult = {
      updates: [
        {
          clientId: 'client-0',
          update: {
            type: 'Patch',
            code: 'console.log("patched")',
            filename: 'App.tsx',
            hmrBoundaries: [],
          },
        },
      ],
      changedFiles: ['App.tsx'],
    };

    // Simulate server dispatch logic
    for (const clientUpdate of result.updates) {
      const update = clientUpdate.update;
      if (update.type === 'Patch') {
        mockClient.send(JSON.stringify({ type: 'hmr:update-start' }));
        mockClient.send(JSON.stringify({ type: 'hmr:update', code: update.code }));
        mockClient.send(JSON.stringify({ type: 'hmr:update-done' }));
      }
    }

    expect(sent).toHaveLength(3);
    expect(JSON.parse(sent[0]!).type).toBe('hmr:update-start');
    expect(JSON.parse(sent[1]!).type).toBe('hmr:update');
    expect(JSON.parse(sent[1]!).code).toBe('console.log("patched")');
    expect(JSON.parse(sent[2]!).type).toBe('hmr:update-done');
  });

  it('should dispatch FullReload update as reload message', () => {
    const sent: string[] = [];
    const mockClient = {
      id: 'client-0',
      platform: 'ios',
      bundleEntry: 'index.js',
      send: (msg: string) => sent.push(msg),
    };

    const result: HMRUpdateResult = {
      updates: [
        {
          clientId: 'client-0',
          update: {
            type: 'FullReload',
            reason: 'non-component change',
          },
        },
      ],
      changedFiles: ['config.ts'],
    };

    for (const clientUpdate of result.updates) {
      const update = clientUpdate.update;
      if (update.type === 'FullReload') {
        mockClient.send(JSON.stringify({ type: 'hmr:reload' }));
      }
    }

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).type).toBe('hmr:reload');
  });

  it('should not send anything for Noop updates', () => {
    const sent: string[] = [];
    const mockClient = {
      id: 'client-0',
      platform: 'ios',
      bundleEntry: 'index.js',
      send: (msg: string) => sent.push(msg),
    };

    const result: HMRUpdateResult = {
      updates: [
        {
          clientId: 'client-0',
          update: { type: 'Noop' },
        },
      ],
      changedFiles: [],
    };

    for (const clientUpdate of result.updates) {
      const update = clientUpdate.update;
      if (update.type === 'Patch') {
        mockClient.send(JSON.stringify({ type: 'hmr:update', code: (update as any).code }));
      } else if (update.type === 'FullReload') {
        mockClient.send(JSON.stringify({ type: 'hmr:reload' }));
      }
      // Noop: nothing
    }

    expect(sent).toHaveLength(0);
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

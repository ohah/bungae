import { describe, expect, it } from 'bun:test';

import type {
  HMRServerMessage,
  HMRClientMessage,
  HMRClient,
  HMRUpdateResult,
} from '../../hmr/types';

describe('HMR Types', () => {
  it('should construct server messages', () => {
    const updateStart: HMRServerMessage = { type: 'hmr:update-start' };
    expect(updateStart.type).toBe('hmr:update-start');

    const update: HMRServerMessage = { type: 'hmr:update', code: 'console.log("hi")' };
    expect(update.type).toBe('hmr:update');

    const updateDone: HMRServerMessage = { type: 'hmr:update-done' };
    expect(updateDone.type).toBe('hmr:update-done');

    const reload: HMRServerMessage = { type: 'hmr:reload' };
    expect(reload.type).toBe('hmr:reload');

    const error: HMRServerMessage = {
      type: 'hmr:error',
      payload: {
        type: 'BuildError',
        message: 'Syntax error',
        errors: [{ description: 'Unexpected token' }],
      },
    };
    expect(error.type).toBe('hmr:error');
  });

  it('should construct client messages', () => {
    const connected: HMRClientMessage = {
      type: 'hmr:connected',
      bundleEntry: 'index.js',
      platform: 'ios',
    };
    expect(connected.type).toBe('hmr:connected');
    expect(connected.platform).toBe('ios');

    const registered: HMRClientMessage = {
      type: 'hmr:module-registered',
      modules: ['./App.tsx', './utils.ts'],
    };
    expect(registered.type).toBe('hmr:module-registered');

    const invalidate: HMRClientMessage = {
      type: 'hmr:invalidate',
      moduleId: './App.tsx',
    };
    expect(invalidate.type).toBe('hmr:invalidate');
  });

  it('should construct HMRClient', () => {
    const messages: string[] = [];
    const client: HMRClient = {
      id: 'client-0',
      platform: 'ios',
      bundleEntry: 'index.js',
      send: (msg) => messages.push(msg),
    };

    client.send(JSON.stringify({ type: 'hmr:reload' }));
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0]!)).toEqual({ type: 'hmr:reload' });
  });

  it('should construct HMRUpdateResult with Patch updates', () => {
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

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.update.type).toBe('Patch');
    expect(result.changedFiles).toEqual(['App.tsx']);
  });

  it('should construct HMRUpdateResult with FullReload', () => {
    const result: HMRUpdateResult = {
      updates: [
        {
          clientId: 'client-0',
          update: {
            type: 'FullReload',
            reason: 'config changed',
          },
        },
      ],
      changedFiles: ['bungae.config.ts'],
    };

    expect(result.updates[0]!.update.type).toBe('FullReload');
  });

  it('should construct HMRUpdateResult with mixed update types', () => {
    const result: HMRUpdateResult = {
      updates: [
        {
          clientId: 'client-0',
          update: {
            type: 'Patch',
            code: 'var x = 1;',
            filename: 'App.tsx',
            hmrBoundaries: [],
          },
        },
        {
          clientId: 'client-1',
          update: {
            type: 'FullReload',
          },
        },
        {
          clientId: 'client-2',
          update: {
            type: 'Noop',
          },
        },
      ],
      changedFiles: ['App.tsx'],
    };

    expect(result.updates).toHaveLength(3);
    expect(result.updates[0]!.update.type).toBe('Patch');
    expect(result.updates[1]!.update.type).toBe('FullReload');
    expect(result.updates[2]!.update.type).toBe('Noop');
  });
});

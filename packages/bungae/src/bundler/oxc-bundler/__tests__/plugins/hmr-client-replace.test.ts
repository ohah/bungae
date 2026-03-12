import { describe, expect, it } from 'bun:test';

import { hmrClientReplacePlugin } from '../../plugins/hmr-client-replace';

describe('hmrClientReplacePlugin', () => {
  it('should return a plugin with correct name', () => {
    const plugin = hmrClientReplacePlugin();
    expect(plugin.name).toBe('bungae:hmr-client-replace');
  });

  it('should have a load hook', () => {
    const plugin = hmrClientReplacePlugin();
    expect(plugin.load).toBeDefined();
  });

  it('should have a filter for HMRClient.js path', () => {
    const plugin = hmrClientReplacePlugin();
    const load = plugin.load as any;
    expect(load.filter).toBeDefined();
    expect(load.filter.id).toBeDefined();
    expect(load.filter.id.include).toBeDefined();
    expect(load.filter.id.include.length).toBeGreaterThan(0);
  });

  it('should match react-native HMRClient path pattern', () => {
    const plugin = hmrClientReplacePlugin();
    const load = plugin.load as any;
    const pattern = load.filter.id.include[0] as RegExp;

    // Should match React Native's HMRClient path
    expect(pattern.test('react-native/Libraries/Utilities/HMRClient')).toBe(true);
    expect(pattern.test('react-native/Libraries/Utilities/HMRClient.js')).toBe(true);
    // Should match with backslash (Windows paths)
    expect(pattern.test('react-native\\Libraries\\Utilities\\HMRClient')).toBe(true);
    // Should not match other files
    expect(pattern.test('react-native/Libraries/Utilities/Platform')).toBe(false);
    expect(pattern.test('some-other-module/HMRClient')).toBe(false);
  });

  it('should return compiled JavaScript code from load handler', async () => {
    const plugin = hmrClientReplacePlugin();
    const load = plugin.load as any;
    const handler = load.handler;

    const result = await handler('react-native/Libraries/Utilities/HMRClient.js');
    expect(result).toBeDefined();
    expect(result.code).toBeTruthy();
    expect(result.moduleType).toBe('js');
    // Should be transpiled (no TypeScript annotations)
    expect(result.code).not.toContain(': string');
    // Should contain HMR client logic
    expect(result.code).toContain('HMRClient');
  });

  it('should cache compiled code across multiple calls', async () => {
    const plugin = hmrClientReplacePlugin();
    const load = plugin.load as any;
    const handler = load.handler;

    const result1 = await handler('react-native/Libraries/Utilities/HMRClient.js');
    const result2 = await handler('react-native/Libraries/Utilities/HMRClient.js');

    // Same reference (cached)
    expect(result1.code).toBe(result2.code);
  });
});

import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { jsonPlugin } from '../../plugins/json';

describe('jsonPlugin', () => {
  const testDir = join(tmpdir(), 'bungae-json-test');

  it('should have correct plugin name', () => {
    const plugin = jsonPlugin();
    expect(plugin.name).toBe('bungae:json');
  });

  it('should have load filter for .json files', () => {
    const plugin = jsonPlugin();
    expect(plugin.load).toBeDefined();
    const load = plugin.load as any;
    expect(load.filter?.id).toEqual(/\.json$/);
  });

  it('should convert JSON to ES module export', () => {
    mkdirSync(testDir, { recursive: true });
    const jsonPath = join(testDir, 'test.json');
    writeFileSync(jsonPath, JSON.stringify({ name: 'test', version: '1.0' }));

    const plugin = jsonPlugin();
    const load = plugin.load as any;
    const result = load.handler(jsonPath);

    expect(result.code).toContain('export default');
    expect(result.code).toContain('"name"');
    expect(result.code).toContain('"test"');
    expect(result.moduleType).toBe('js');

    rmSync(testDir, { recursive: true, force: true });
  });

  it('should throw on invalid JSON', () => {
    mkdirSync(testDir, { recursive: true });
    const jsonPath = join(testDir, 'invalid.json');
    writeFileSync(jsonPath, '{ invalid json }');

    const plugin = jsonPlugin();
    const load = plugin.load as any;

    expect(() => load.handler(jsonPath)).toThrow();

    rmSync(testDir, { recursive: true, force: true });
  });
});

import { describe, expect, it } from 'bun:test';

import { patchRolldownRuntime, transformForHermes } from '../../hmr/hermes-compat-utils';

describe('patchRolldownRuntime', () => {
  it('should patch __defProp to add configurable: true', () => {
    const input = 'var __defProp = Object.defineProperty;\nvar x = 1;';
    const result = patchRolldownRuntime(input);

    expect(result.code).not.toContain('var __defProp = Object.defineProperty;');
    expect(result.code).toContain('desc.configurable = true');
    expect(result.code).toContain('Object.defineProperty(obj, key, desc)');
  });

  it('should return source map when patching', () => {
    const input = 'var __defProp = Object.defineProperty;\nvar x = 1;';
    const result = patchRolldownRuntime(input);

    expect(result.map).toBeDefined();
    const map = JSON.parse(result.map!);
    expect(map.mappings).toBeTruthy();
  });

  it('should return code unchanged when __defProp pattern is not found', () => {
    const input = 'var x = 1;\nconsole.log(x);';
    const result = patchRolldownRuntime(input);
    expect(result.code).toBe(input);
    expect(result.map).toBeUndefined();
  });

  it('should not modify code when __defProp pattern does not match', () => {
    const input = 'var __defProp = someOtherFunction;\n__defProp(obj, key, desc);';
    const result = patchRolldownRuntime(input);
    // No match → code unchanged
    expect(result.code).toBe(input);
  });

  it('should not warn when __defProp is not used at all', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    const input = 'var x = 1;';
    patchRolldownRuntime(input);

    expect(warnings).toHaveLength(0);

    console.warn = originalWarn;
  });

  it('should only patch the first occurrence', () => {
    const input =
      'var __defProp = Object.defineProperty;\n' + 'var __defProp2 = Object.defineProperty;\n';
    const result = patchRolldownRuntime(input);

    // First one patched
    expect(result.code).toContain('desc.configurable = true');
    // Second one remains (different variable name, no match)
    expect(result.code).toContain('var __defProp2 = Object.defineProperty;');
  });
});

describe('transformForHermes', () => {
  it('should convert arrow functions to regular functions', async () => {
    const input = 'const fn = () => 42;';
    const result = await transformForHermes(input);
    expect(result).not.toContain('=>');
  });

  it('should convert const/let to var', async () => {
    const input = 'const x = 1;\nlet y = 2;';
    const result = await transformForHermes(input);
    expect(result).not.toContain('const ');
    expect(result).not.toContain('let ');
    expect(result).toContain('var ');
  });

  it('should convert template literals to string concatenation', async () => {
    const input = 'const msg = `hello ${name}`;';
    const result = await transformForHermes(input);
    expect(result).not.toContain('`');
  });

  it('should handle class expressions', async () => {
    const input = 'var Foo = class { constructor() { this.x = 1; } };';
    const result = await transformForHermes(input);
    // SWC converts class to function with ES5 target
    // The class keyword should not appear as a declaration (helper names like _class_call_check are ok)
    expect(result).not.toContain('= class');
    expect(result).toContain('function Foo()');
  });
});

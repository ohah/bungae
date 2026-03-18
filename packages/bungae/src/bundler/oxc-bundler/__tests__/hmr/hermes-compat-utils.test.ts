import { describe, expect, it } from 'bun:test';

import { transformForHermes } from '../../hmr/hermes-compat-utils';

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

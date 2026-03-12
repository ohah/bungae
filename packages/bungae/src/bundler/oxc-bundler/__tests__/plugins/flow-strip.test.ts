import { describe, expect, it } from 'bun:test';

import { containsFlowSyntax } from '../../plugins/flow-strip';

describe('containsFlowSyntax', () => {
  it('should detect @flow pragma in block comment', () => {
    expect(containsFlowSyntax('/* @flow */\nconst x = 1;')).toBe(true);
  });

  it('should detect @flow pragma in line comment', () => {
    expect(containsFlowSyntax('// @flow\nconst x = 1;')).toBe(true);
  });

  it('should detect @flow strict-local in JSDoc block', () => {
    expect(containsFlowSyntax('/**\n * @flow strict-local\n */\nconst x = 1;')).toBe(true);
  });

  it('should detect @flow strict in JSDoc block', () => {
    expect(containsFlowSyntax('/**\n * @flow strict\n */')).toBe(true);
  });

  it('should detect opaque type keyword', () => {
    expect(containsFlowSyntax('opaque type ID = string;')).toBe(true);
  });

  it('should detect declare module', () => {
    expect(containsFlowSyntax('declare module "foo" {}')).toBe(true);
  });

  it('should detect declare class', () => {
    expect(containsFlowSyntax('declare class Foo {}')).toBe(true);
  });

  it('should detect declare function', () => {
    expect(containsFlowSyntax('declare function foo(): void;')).toBe(true);
  });

  it('should detect declare export', () => {
    expect(containsFlowSyntax('declare export type Foo = string;')).toBe(true);
  });

  it('should not detect regular TypeScript code', () => {
    expect(containsFlowSyntax('const x: number = 1;\ninterface Foo { bar: string; }')).toBe(false);
  });

  it('should not detect plain JavaScript', () => {
    expect(containsFlowSyntax('const x = 1;\nfunction foo() { return x; }')).toBe(false);
  });

  it('should not false-positive on comment mentioning flow', () => {
    expect(containsFlowSyntax('// this controls the flow of execution\nconst x = 1;')).toBe(false);
  });
});

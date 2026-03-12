import { describe, expect, it } from 'bun:test';

import { generatePreludeCode } from '../../plugins/prelude';

describe('generatePreludeCode', () => {
  it('should set __DEV__ to true in development', () => {
    const code = generatePreludeCode(true, 'ios');
    expect(code).toContain('var __DEV__ = true');
  });

  it('should set __DEV__ to false in production', () => {
    const code = generatePreludeCode(false, 'ios');
    expect(code).toContain('var __DEV__ = false');
  });

  it('should set process.env.NODE_ENV to development', () => {
    const code = generatePreludeCode(true, 'ios');
    expect(code).toContain('process.env.NODE_ENV = "development"');
  });

  it('should set process.env.NODE_ENV to production', () => {
    const code = generatePreludeCode(false, 'ios');
    expect(code).toContain('process.env.NODE_ENV = "production"');
  });

  it('should set up __BUNDLE_START_TIME__', () => {
    const code = generatePreludeCode(true, 'ios');
    expect(code).toContain('__BUNDLE_START_TIME__');
  });

  it('should set up globalThis.__DEV__', () => {
    const code = generatePreludeCode(true, 'ios');
    expect(code).toContain('globalThis.__DEV__ = __DEV__');
  });

  it('should set up globalThis.process', () => {
    const code = generatePreludeCode(true, 'ios');
    expect(code).toContain('globalThis.process = process');
  });
});

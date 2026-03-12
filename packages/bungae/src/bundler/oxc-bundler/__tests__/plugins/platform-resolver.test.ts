import { describe, expect, it } from 'bun:test';

import { buildExtensions } from '../../plugins/platform-resolver';

describe('buildExtensions', () => {
  it('should generate platform-specific extensions for iOS', () => {
    const extensions = buildExtensions('ios', ['.ts', '.tsx', '.js', '.jsx']);
    expect(extensions).toEqual([
      '.ios.ts',
      '.native.ts',
      '.ts',
      '.ios.tsx',
      '.native.tsx',
      '.tsx',
      '.ios.js',
      '.native.js',
      '.js',
      '.ios.jsx',
      '.native.jsx',
      '.jsx',
    ]);
  });

  it('should generate platform-specific extensions for Android', () => {
    const extensions = buildExtensions('android', ['.ts', '.js']);
    expect(extensions).toEqual([
      '.android.ts',
      '.native.ts',
      '.ts',
      '.android.js',
      '.native.js',
      '.js',
    ]);
  });

  it('should handle extensions without leading dots', () => {
    const extensions = buildExtensions('ios', ['ts', 'js']);
    expect(extensions).toEqual([
      '.ios.ts',
      '.native.ts',
      '.ts',
      '.ios.js',
      '.native.js',
      '.js',
    ]);
  });

  it('should place platform extensions before native extensions', () => {
    const extensions = buildExtensions('ios', ['.tsx']);
    expect(extensions.indexOf('.ios.tsx')).toBeLessThan(
      extensions.indexOf('.native.tsx'),
    );
    expect(extensions.indexOf('.native.tsx')).toBeLessThan(
      extensions.indexOf('.tsx'),
    );
  });
});

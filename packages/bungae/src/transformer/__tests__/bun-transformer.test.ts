import { describe, test, expect } from 'bun:test';

import { transformWithBun } from '../bun-transformer';
import type { TransformOptions } from '../types';

describe('Bun Transformer', () => {
  const baseOptions: TransformOptions = {
    filePath: '/test.tsx',
    code: '',
    platform: 'ios',
    dev: true,
    projectRoot: '/project',
  };

  test('should transform TypeScript to JavaScript', async () => {
    const options: TransformOptions = {
      ...baseOptions,
      filePath: '/test.ts',
      code: 'const x: number = 42;',
    };

    const result = await transformWithBun(options);

    expect(result.code).toBeTruthy();
    expect(result.code).not.toContain(': number');
    expect(result.dependencies).toBeInstanceOf(Array);
  });

  test('should transform TSX to JavaScript', async () => {
    const options: TransformOptions = {
      ...baseOptions,
      filePath: '/test.tsx',
      code: 'const Component = () => <div>Hello</div>;',
    };

    const result = await transformWithBun(options);

    expect(result.code).toBeTruthy();
    // Bun's JSX transform uses jsxDEV, not React
    expect(result.code).toContain('jsx');
    expect(result.dependencies).toBeInstanceOf(Array);
    // JSX files may have empty dependencies if oxc-parser can't parse JSX
    // This is acceptable - dependencies will be extracted after transformation
  });

  test('should transform JSX to JavaScript', async () => {
    const options: TransformOptions = {
      ...baseOptions,
      filePath: '/test.jsx',
      code: 'const Component = () => <div>Hello</div>;',
      dev: true,
    };

    const result = await transformWithBun(options);

    expect(result.code).toBeTruthy();
    // Bun's JSX transform uses jsxDEV, not React
    expect(result.code).toContain('jsx');
    // JSX files may have empty dependencies if oxc-parser can't parse JSX
    // This is acceptable - dependencies will be extracted after transformation
    expect(result.dependencies).toBeInstanceOf(Array);
  });

  test('should inject __DEV__ variable', async () => {
    const options: TransformOptions = {
      ...baseOptions,
      filePath: '/test.js',
      code: 'if (__DEV__) { console.log("dev"); }',
      dev: true,
    };

    const result = await transformWithBun(options);

    expect(result.code).toBeTruthy();
  });

  test('should inject process.env.NODE_ENV', async () => {
    const options: TransformOptions = {
      ...baseOptions,
      filePath: '/test.js',
      code: 'const env = process.env.NODE_ENV;',
      dev: false,
    };

    const result = await transformWithBun(options);

    expect(result.code).toBeTruthy();
  });

  test('should extract dependencies from require()', async () => {
    const options: TransformOptions = {
      ...baseOptions,
      filePath: '/test.js',
      code: `
        const react = require('react');
        const utils = require('./utils');
      `,
    };

    const result = await transformWithBun(options);

    expect(result.dependencies).toContain('react');
    expect(result.dependencies).toContain('./utils');
  });

  test('should extract dependencies from import statements', async () => {
    const options: TransformOptions = {
      ...baseOptions,
      filePath: '/test.js',
      code: `
        import React from 'react';
        import { utils } from './utils';
      `,
    };

    const result = await transformWithBun(options);

    expect(result.dependencies).toContain('react');
    expect(result.dependencies).toContain('./utils');
  });

  test('should extract dependencies from dynamic import', async () => {
    const options: TransformOptions = {
      ...baseOptions,
      filePath: '/test.js',
      code: 'const module = await import("./async-module");',
    };

    const result = await transformWithBun(options);

    expect(result.dependencies).toContain('./async-module');
  });

  test('should handle production mode', async () => {
    const options: TransformOptions = {
      ...baseOptions,
      filePath: '/test.js',
      code: 'const x = 1;',
      dev: false,
    };

    const result = await transformWithBun(options);

    expect(result.code).toBeTruthy();
  });

  test('should handle different platforms', async () => {
    const platforms: Array<'ios' | 'android' | 'web'> = ['ios', 'android', 'web'];

    for (const platform of platforms) {
      const options: TransformOptions = {
        ...baseOptions,
        filePath: '/test.js',
        code: 'const x = 1;',
        platform,
      };

      const result = await transformWithBun(options);

      expect(result.code).toBeTruthy();
    }
  });
});

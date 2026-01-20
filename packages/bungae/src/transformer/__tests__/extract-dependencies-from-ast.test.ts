/**
 * Extract Dependencies from AST Tests
 *
 * Tests that we extract dependencies from AST directly (Metro-compatible)
 * without generating code temporarily.
 */

import { describe, test, expect } from 'bun:test';

import { extractDependenciesFromAst } from '../extract-dependencies-from-ast';

describe('extractDependenciesFromAst', () => {
  test('should extract import declarations from AST', async () => {
    const babel = await import('@babel/core');
    // babel.parseAsync returns File node, but we can traverse it directly
    const fileAst = await babel.parseAsync(
      `import React from 'react';
import { useState } from 'react';
import Component from './Component';`,
      {
        sourceType: 'module',
      },
    );

    const deps = await extractDependenciesFromAst(fileAst);
    expect(deps).toContain('react');
    expect(deps).toContain('./Component');
    // 'react' appears twice but should be deduplicated
    expect(deps.filter((d) => d === 'react').length).toBe(1);
    expect(deps.length).toBe(2);
  });

  test('should extract export declarations from AST', async () => {
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync(
      `export { foo } from './foo';
export * from './bar';`,
      {
        sourceType: 'module',
      },
    );

    const deps = await extractDependenciesFromAst(ast);
    expect(deps).toContain('./foo');
    expect(deps).toContain('./bar');
  });

  test('should extract require() calls from AST', async () => {
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync(
      `const React = require('react');
const Component = require('./Component');`,
      {
        sourceType: 'module',
      },
    );

    const deps = await extractDependenciesFromAst(ast);
    expect(deps).toContain('react');
    expect(deps).toContain('./Component');
  });

  test('should extract dynamic import() calls from AST', async () => {
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync(
      `const module = await import('./lazy');
import('./another');`,
      {
        sourceType: 'module',
      },
    );

    const deps = await extractDependenciesFromAst(ast);
    expect(deps).toContain('./lazy');
    expect(deps).toContain('./another');
  });

  test('should filter out Flow file imports', async () => {
    const babel = await import('@babel/core');
    // Use Hermes parser for Flow syntax (import type)
    const hermesParser = await import('hermes-parser');
    const code = `import React from 'react';
import type { Type } from './types.flow';
import Component from './Component.flow.js';`;
    const sourceAst = hermesParser.parse(code, {
      babel: true,
      sourceType: 'module',
    });
    const transformResult = await babel.transformFromAstAsync(sourceAst, code, {
      ast: true,
      code: false,
      babelrc: false,
      configFile: false,
    });
    const ast = transformResult?.ast || sourceAst;

    const deps = await extractDependenciesFromAst(ast);
    expect(deps).toContain('react');
    expect(deps).not.toContain('./types.flow');
    expect(deps).not.toContain('./Component.flow.js');
  });

  test('should handle TypeScript files', async () => {
    const babel = await import('@babel/core');
    const { createRequire } = await import('module');
    const { join } = await import('path');
    const { fileURLToPath } = await import('url');
    // Resolve TypeScript plugin from packages/bungae (where dependencies are)
    // Current file: packages/bungae/src/transformer/__tests__/extract-dependencies-from-ast.test.ts
    // Target: packages/bungae/package.json
    const currentFile = fileURLToPath(import.meta.url);
    // Go up 4 levels: __tests__ -> transformer -> src -> bungae
    const packageDir = join(currentFile, '..', '..', '..', '..');

    // Helper to resolve plugin with fallback
    function resolvePlugin(pluginName: string): string {
      try {
        const packageRequire = createRequire(join(packageDir, 'package.json'));
        return packageRequire.resolve(pluginName);
      } catch {
        const rootRequire = createRequire(join(packageDir, '..', '..', 'package.json'));
        return rootRequire.resolve(pluginName);
      }
    }

    const tsPluginPath = resolvePlugin('@babel/plugin-transform-typescript');

    // TypeScript files need typescript plugin for import type syntax
    const ast = await babel.parseAsync(
      `import React from 'react';
import type { Props } from './types';
const Component: React.FC<Props> = () => null;`,
      {
        sourceType: 'module',
        plugins: [[tsPluginPath, { isTSX: false }]],
      },
    );

    const deps = await extractDependenciesFromAst(ast);
    expect(deps).toContain('react');
    // Type-only imports might be in AST but we extract them anyway
  });

  test('should deduplicate dependencies', async () => {
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync(
      `import React from 'react';
import { useState } from 'react';
const React2 = require('react');`,
      {
        sourceType: 'module',
      },
    );

    const deps = await extractDependenciesFromAst(ast);
    const reactCount = deps.filter((d) => d === 'react').length;
    expect(reactCount).toBe(1); // Should be deduplicated
  });

  test('should handle empty AST', async () => {
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync('', {
      sourceType: 'module',
    });

    const deps = await extractDependenciesFromAst(ast);
    expect(deps).toEqual([]);
  });

  test('should handle complex mixed imports', async () => {
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync(
      `import React from 'react';
import { useState, useEffect } from 'react';
export { Component } from './Component';
const utils = require('./utils');
const lazy = await import('./lazy');`,
      {
        sourceType: 'module',
      },
    );

    const deps = await extractDependenciesFromAst(ast);
    expect(deps).toContain('react');
    expect(deps).toContain('./Component');
    expect(deps).toContain('./utils');
    expect(deps).toContain('./lazy');
    // Should deduplicate 'react'
    expect(deps.filter((d) => d === 'react').length).toBe(1);
  });
});

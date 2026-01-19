import { describe, test, expect } from 'bun:test';

import { getLoader, extractDependencies } from '../utils';

describe('Transformer Utils', () => {
  describe('getLoader', () => {
    test('should return tsx for .tsx files', () => {
      expect(getLoader('/test.tsx')).toBe('tsx');
    });

    test('should return ts for .ts files', () => {
      expect(getLoader('/test.ts')).toBe('ts');
    });

    test('should return jsx for .jsx files', () => {
      expect(getLoader('/test.jsx')).toBe('jsx');
    });

    test('should return js for .js files', () => {
      expect(getLoader('/test.js')).toBe('js');
    });

    test('should return js for files without extension', () => {
      expect(getLoader('/test')).toBe('js');
    });
  });

  describe('extractDependencies (AST-based)', () => {
    test('should extract default import', async () => {
      const code = `import React from 'react';`;
      const deps = await extractDependencies(code);
      expect(deps).toContain('react');
    });

    test('should extract named imports', async () => {
      const code = `import { useState, useEffect } from 'react';`;
      const deps = await extractDependencies(code);
      expect(deps).toContain('react');
    });

    test('should extract namespace import', async () => {
      const code = `import * as React from 'react';`;
      const deps = await extractDependencies(code);
      expect(deps).toContain('react');
    });

    test('should extract side-effect import', async () => {
      const code = `import './polyfills';`;
      const deps = await extractDependencies(code);
      expect(deps).toContain('./polyfills');
    });

    test('should extract multiple imports', async () => {
      const code = `
        import React from 'react';
        import { View } from 'react-native';
        import './utils';
      `;
      const deps = await extractDependencies(code);
      expect(deps).toContain('react');
      expect(deps).toContain('react-native');
      expect(deps).toContain('./utils');
    });

    test('should extract require() calls', async () => {
      const code = `const React = require('react');`;
      const deps = await extractDependencies(code);
      expect(deps).toContain('react');
    });

    test('should extract dynamic import', async () => {
      const code = `const module = await import('./async-module');`;
      const deps = await extractDependencies(code);
      expect(deps).toContain('./async-module');
    });

    test('should extract mixed imports and requires', async () => {
      const code = `
        import React from 'react';
        const utils = require('./utils');
        async function load() {
          const async = await import('./async');
        }
      `;
      const deps = await extractDependencies(code);
      expect(deps).toContain('react');
      expect(deps).toContain('./utils');
      expect(deps).toContain('./async');
    });

    test('should filter out Flow file imports', async () => {
      const code = `import './file.flow.js';`;
      const deps = await extractDependencies(code);
      expect(deps).not.toContain('./file.flow.js');
    });

    test('should handle TypeScript files', async () => {
      const code = `
        import type { Props } from './types';
        import { Component } from './Component';
      `;
      const deps = await extractDependencies(code);
      // Type-only imports should be filtered out, but Component import should remain
      expect(deps).toContain('./Component');
    });

    test('should extract relative path imports', async () => {
      const code = `import { helper } from './helpers/utils';`;
      const deps = await extractDependencies(code);
      expect(deps).toContain('./helpers/utils');
    });

    test('should extract absolute path imports', async () => {
      const code = `import { something } from '/absolute/path';`;
      const deps = await extractDependencies(code);
      expect(deps).toContain('/absolute/path');
    });

    test('should handle multiline imports', async () => {
      const code = `
        import {
          Component1,
          Component2
        } from 'react-native';
      `;
      const deps = await extractDependencies(code);
      expect(deps).toContain('react-native');
    });

    test('should extract default and named imports together', async () => {
      const code = `import React, { useState, useEffect } from 'react';`;
      const deps = await extractDependencies(code);
      expect(deps).toContain('react');
      // Should only extract the module path, not individual named imports
      expect(deps.length).toBe(1);
    });

    test('should remove duplicates', async () => {
      const code = `
        import React from 'react';
        import { useState } from 'react';
        const React2 = require('react');
      `;
      const deps = await extractDependencies(code);
      // Should only have 'react' once
      expect(deps.filter((d) => d === 'react').length).toBe(1);
    });

    test('should handle empty code', async () => {
      const code = '';
      const deps = await extractDependencies(code);
      expect(deps).toEqual([]);
    });

    test('should handle code without imports', async () => {
      const code = `const x = 1; const y = 2;`;
      const deps = await extractDependencies(code);
      expect(deps).toEqual([]);
    });
  });
});

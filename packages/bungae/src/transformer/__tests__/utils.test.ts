import { describe, test, expect } from 'bun:test';

import { getLoader } from '../utils';

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
});

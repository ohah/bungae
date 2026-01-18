import { describe, test, expect } from 'bun:test';

import { createModuleIdFactory, getRunModuleStatement } from '../utils';

describe('Serializer Utils', () => {
  describe('createModuleIdFactory', () => {
    test('should create unique IDs for different paths', () => {
      const factory = createModuleIdFactory();
      const id1 = factory('/path/to/file1.js');
      const id2 = factory('/path/to/file2.js');

      expect(id1).toBe(0);
      expect(id2).toBe(1);
      expect(id1).not.toBe(id2);
    });

    test('should return same ID for same path', () => {
      const factory = createModuleIdFactory();
      const id1 = factory('/path/to/file.js');
      const id2 = factory('/path/to/file.js');

      expect(id1).toBe(id2);
    });

    test('should create sequential IDs', () => {
      const factory = createModuleIdFactory();
      const ids = [factory('/file1.js'), factory('/file2.js'), factory('/file3.js')];

      expect(ids).toEqual([0, 1, 2]);
    });
  });

  describe('getRunModuleStatement', () => {
    test('should generate run module statement with numeric ID', () => {
      const statement = getRunModuleStatement(0);
      expect(statement).toBe('__r(0);');
    });

    test('should generate run module statement with string ID', () => {
      const statement = getRunModuleStatement('module1');
      expect(statement).toBe('__r("module1");');
    });

    test('should ignore global prefix (__r always uses no prefix)', () => {
      const statement = getRunModuleStatement(0, 'customPrefix');
      // __r() always uses no prefix, regardless of globalPrefix
      expect(statement).toBe('__r(0);');
    });

    test('should handle empty global prefix', () => {
      const statement = getRunModuleStatement(0, '');
      expect(statement).toBe('__r(0);');
    });
  });
});

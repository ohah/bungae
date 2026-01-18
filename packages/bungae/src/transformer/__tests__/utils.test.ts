import { describe, test, expect } from 'bun:test';

import type { TransformerConfig } from '../../config/types';
import { shouldUseBabel, getLoader } from '../utils';

describe('Transformer Utils', () => {
  describe('shouldUseBabel', () => {
    test('should return false when babel config is not provided', () => {
      const config: TransformerConfig = {};

      expect(shouldUseBabel('/test.js', config)).toBe(false);
    });

    test('should return false when babel.include is empty', () => {
      const config: TransformerConfig = {
        babel: {
          include: [],
        },
      };

      expect(shouldUseBabel('/test.js', config)).toBe(false);
    });

    test('should return true when file matches pattern', () => {
      const config: TransformerConfig = {
        babel: {
          include: ['**/react-native-reanimated/**'],
        },
      };

      expect(shouldUseBabel('/node_modules/react-native-reanimated/index.js', config)).toBe(true);
    });

    test('should return false when file does not match pattern', () => {
      const config: TransformerConfig = {
        babel: {
          include: ['**/react-native-reanimated/**'],
        },
      };

      expect(shouldUseBabel('/test.js', config)).toBe(false);
    });

    test('should handle multiple patterns', () => {
      const config: TransformerConfig = {
        babel: {
          include: ['**/react-native-reanimated/**', '**/react-native-gesture-handler/**'],
        },
      };

      expect(shouldUseBabel('/node_modules/react-native-reanimated/index.js', config)).toBe(true);
      expect(shouldUseBabel('/node_modules/react-native-gesture-handler/index.js', config)).toBe(
        true,
      );
      expect(shouldUseBabel('/test.js', config)).toBe(false);
    });
  });

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

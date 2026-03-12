/**
 * JSON Plugin for Rolldown
 *
 * Converts JSON files to ES module exports.
 * Supports both default export and named exports for object keys.
 * React Native commonly imports JSON for config, translations, etc.
 */

import { readFileSync } from 'fs';

import type { Plugin } from 'rolldown';

export function jsonPlugin(): Plugin {
  return {
    name: 'bungae:json',

    load: {
      filter: { id: /\.json$/ },
      handler(id) {
        const rawJson = readFileSync(id, 'utf-8');
        const parsed = JSON.parse(rawJson);

        // Generate named exports for object keys + default export
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const namedExports = Object.keys(parsed)
            .filter((key) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key))
            .map((key) => `export var ${key} = ${JSON.stringify(parsed[key])};`)
            .join('\n');

          return {
            code: `${namedExports}\nexport default ${rawJson};`,
            moduleType: 'js',
          };
        }

        return {
          code: `export default ${rawJson};`,
          moduleType: 'js',
        };
      },
    },
  };
}

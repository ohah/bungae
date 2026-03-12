/**
 * JSON Plugin for Rolldown
 *
 * Converts JSON files to ES module exports.
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
        // Validate JSON before wrapping
        JSON.parse(rawJson);
        return {
          code: `export default ${rawJson};`,
          moduleType: 'js',
        };
      },
    },
  };
}

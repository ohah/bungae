/**
 * ZTS Babel Transform Plugin
 *
 * Runs user-configured Babel plugins on source files during ZTS bundling.
 * Activated when babel.config.js contains custom plugins (e.g., react-native-reanimated/plugin).
 *
 * IMPORTANT: Init must respond instantly — Babel is lazy-loaded on first transform.
 * This prevents race conditions with ZTS's multi-threaded module parsing.
 *
 * Environment variables:
 *   ZTS_PROJECT_ROOT  — Project root directory
 *   ZTS_SOURCE_EXTS   — Source file extensions to transform (comma-separated)
 */

import { extname } from 'node:path';
import { createInterface } from 'node:readline';

import { detectCustomPlugins, createBabelTransformer } from './plugin-core';

const SOURCE_EXTS = new Set(
  (process.env.ZTS_SOURCE_EXTS || '.js,.jsx,.ts,.tsx')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean),
);

const PROJECT_ROOT = process.env.ZTS_PROJECT_ROOT || process.cwd();

const hasCustomPlugins = detectCustomPlugins(PROJECT_ROOT);

let transformer: ((code: string, filename: string) => string | null) | null = null;

// ===== IPC Protocol =====

interface IpcMessage {
  id: number;
  type: string;
  path?: string;
  code?: string;
  moduleId?: string;
}

function handleMessage(msg: IpcMessage): string {
  switch (msg.type) {
    case 'init':
      // Respond INSTANTLY — no Babel loading here
      return JSON.stringify({
        id: msg.id,
        name: 'bungae:babel-transform',
        filters: {
          resolveId: [],
          load: [],
          transform: hasCustomPlugins ? ['.js', '.jsx', '.ts', '.tsx'] : [],
        },
        hooks: {
          resolveId: false,
          load: false,
          transform: hasCustomPlugins,
          renderChunk: false,
          generateBundle: false,
        },
        config: {},
        error: null,
      });

    case 'transform': {
      const filePath = msg.moduleId || msg.path;
      const code = msg.code;

      if (!filePath || !code) {
        return JSON.stringify({ id: msg.id, result: null, error: null });
      }

      if (!SOURCE_EXTS.has(extname(filePath).toLowerCase())) {
        return JSON.stringify({ id: msg.id, result: null, error: null });
      }

      // Skip node_modules
      if (filePath.includes('/node_modules/')) {
        return JSON.stringify({ id: msg.id, result: null, error: null });
      }

      if (!hasCustomPlugins) {
        return JSON.stringify({ id: msg.id, result: null, error: null });
      }

      try {
        if (!transformer) {
          transformer = createBabelTransformer(PROJECT_ROOT);
        }

        const result = transformer(code, filePath);
        if (result) {
          return JSON.stringify({
            id: msg.id,
            result: { code: result },
            error: null,
          });
        }
        return JSON.stringify({ id: msg.id, result: null, error: null });
      } catch (err: any) {
        return JSON.stringify({
          id: msg.id,
          result: null,
          error: `[bungae:babel-transform] ${err.message}`,
        });
      }
    }

    case 'shutdown':
      process.exit(0);

    default:
      return JSON.stringify({ id: msg.id, result: null, error: null });
  }
}

// ===== IPC Loop =====

const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

rl.on('line', (line) => {
  try {
    const msg: IpcMessage = JSON.parse(line);
    process.stdout.write(handleMessage(msg) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ id: 0, result: null, error: String(err) }) + '\n');
  }
});

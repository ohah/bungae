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

const SOURCE_EXTS = new Set(
  (process.env.ZTS_SOURCE_EXTS || '.js,.jsx,.ts,.tsx')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean),
);

const PROJECT_ROOT = process.env.ZTS_PROJECT_ROOT || process.cwd();

// Check if babel.config.js has custom plugins — NO require('@babel/core') here (too slow)
let hasCustomPlugins = false;
try {
  const { existsSync } = require('node:fs');
  const { join } = require('node:path');
  const configPath = join(PROJECT_ROOT, 'babel.config.js');
  if (existsSync(configPath)) {
    const config = require(configPath);
    const plugins: string[] = config?.plugins || [];
    hasCustomPlugins = plugins.some((p) => {
      const name = typeof p === 'string' ? p : Array.isArray(p) ? p[0] : '';
      return (
        typeof name === 'string' &&
        (name.includes('reanimated') || name.includes('nativewind') || name.includes('worklet'))
      );
    });
  }
} catch {
  // ignore
}

// Lazy-loaded Babel state
let babel: any = null;
let babelOptions: any = null;

function ensureBabel() {
  if (babel) return;
  babel = require('@babel/core');

  const { join } = require('node:path');
  const configPath = join(PROJECT_ROOT, 'babel.config.js');
  const config = require(configPath);
  const plugins: string[] = config?.plugins || [];

  const customPaths: string[] = [];
  for (const plugin of plugins) {
    const name = typeof plugin === 'string' ? plugin : Array.isArray(plugin) ? plugin[0] : '';
    if (
      typeof name === 'string' &&
      (name.includes('reanimated') || name.includes('nativewind') || name.includes('worklet'))
    ) {
      try {
        customPaths.push(require.resolve(name));
      } catch {
        customPaths.push(name);
      }
    }
  }

  babelOptions = {
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: customPaths,
    babelrc: false,
    configFile: false,
    compact: false,
    sourceMaps: false,
  };

  process.stderr.write(`[bungae:babel] loaded: ${customPaths.join(', ')}\n`);
}

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
        // Lazy-load Babel on first transform call
        ensureBabel();

        const result = babel.transformSync(code, {
          ...babelOptions,
          filename: filePath,
        });

        if (result?.code && result.code !== code) {
          process.stderr.write(
            `[bungae:babel] ${filePath.split('/').pop()}: ${code.length} → ${result.code.length}\n`,
          );
          return JSON.stringify({
            id: msg.id,
            result: { code: result.code },
            error: null,
          });
        }
        return JSON.stringify({ id: msg.id, result: null, error: null });
      } catch (err: any) {
        process.stderr.write(`[bungae:babel] error: ${err.message?.slice(0, 100)}\n`);
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

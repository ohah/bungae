/**
 * ZTS Babel Transform Plugin
 *
 * Runs user-configured Babel plugins on source files during ZTS bundling.
 * Activated when babel.config.js contains custom plugins (e.g., react-native-reanimated/plugin).
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

// Detect custom Babel plugins by reading babel.config.js directly (faster than loadPartialConfig)
let babel: any;
let hasCustomPlugins = false;
const customPluginPaths: string[] = [];

try {
  babel = require('@babel/core');

  // Read babel.config.js directly for speed
  const { existsSync } = require('node:fs');
  const { join } = require('node:path');
  const configPath = join(PROJECT_ROOT, 'babel.config.js');

  if (existsSync(configPath)) {
    const config = require(configPath);
    const plugins: string[] = config?.plugins || [];
    for (const plugin of plugins) {
      const name = typeof plugin === 'string' ? plugin : Array.isArray(plugin) ? plugin[0] : '';
      if (
        typeof name === 'string' &&
        (name.includes('reanimated') || name.includes('nativewind') || name.includes('worklet'))
      ) {
        try {
          customPluginPaths.push(require.resolve(name));
        } catch {
          customPluginPaths.push(name);
        }
      }
    }
  }

  hasCustomPlugins = customPluginPaths.length > 0;
  process.stderr.write(
    `[bungae:babel] custom plugins: ${hasCustomPlugins ? customPluginPaths.join(', ') : 'none'}\n`,
  );
} catch (e: any) {
  process.stderr.write(`[bungae:babel] init error: ${e.message}\n`);
}

// Only run custom plugins with TypeScript parser — NOT the full @react-native/babel-preset.
// ZTS handles standard transforms (TSX, Flow, ESM→CJS, etc.)
const babelOptions = hasCustomPlugins
  ? {
      presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
      plugins: customPluginPaths,
      babelrc: false,
      configFile: false,
      compact: false,
      sourceMaps: false,
    }
  : null;

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

      if (!babelOptions) {
        return JSON.stringify({ id: msg.id, result: null, error: null });
      }

      try {
        process.stderr.write(`[bungae:babel] transforming: ${filePath.split('/').pop()}\n`);
        const result = babel.transformSync(code, {
          ...babelOptions,
          filename: filePath,
        });

        if (result?.code && result.code !== code) {
          process.stderr.write(
            `[bungae:babel] transformed: ${code.length} → ${result.code.length}\n`,
          );
          return JSON.stringify({
            id: msg.id,
            result: { code: result.code },
            error: null,
          });
        }
        process.stderr.write(`[bungae:babel] no change\n`);
        return JSON.stringify({ id: msg.id, result: null, error: null });
      } catch (err: any) {
        process.stderr.write(`[bungae:babel] error: ${err.message.slice(0, 100)}\n`);
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

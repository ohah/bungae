/**
 * Bungae configuration for ExampleApp
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Use source files directly during development (avoid dist/index.js issues)
import { defineConfig } from '../../packages/bungae/src/config';
import type { BungaeConfig } from '../../packages/bungae/src/config/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: __dirname,
  entry: 'index.js',
  platform: 'ios', // Can be overridden via CLI: --platform android
  dev: true,
  minify: false,
  outDir: join(__dirname, '.bungae'),
  resolver: {
    sourceExts: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
    assetExts: [
      '.bmp',
      '.gif',
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.avif',
      '.ico',
      '.icns',
      '.icxl',
    ],
    platforms: ['ios', 'android', 'native'],
    preferNativePlatform: true,
  },
  transformer: {
    babel: {
      include: [],
      plugins: [],
      presets: [],
    },
    minifier: 'bun',
    inlineRequires: false,
  },
  serializer: {
    polyfills: [],
    prelude: [],
    bundleType: 'plain',
    extraVars: {
      __BUNGAE__: true,
    },
  },
  server: {
    port: 8081,
    useGlobalHotkey: true,
    forwardClientLogs: true,
    verifyConnections: false,
  },
} satisfies BungaeConfig);

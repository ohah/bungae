/**
 * Bungae configuration for ExampleApp
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Use source files directly during development (avoid dist/index.js issues)
import { defineConfig } from 'bungae';
import type { BungaeConfig } from 'bungae';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: __dirname,
  entry: 'index.js',
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
    // Monorepo support: include monorepo root node_modules (Metro-compatible)
    nodeModulesPaths: [join(__dirname, '../../node_modules')],
  },
  transformer: {
    minifier: 'terser',
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

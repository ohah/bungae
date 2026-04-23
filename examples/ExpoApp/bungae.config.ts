import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  bundler: 'zts',
  resolver: {
    sourceExts: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
    assetExts: [
      '.bmp', '.gif', '.jpg', '.jpeg', '.png', '.webp', '.avif', '.ico', '.icns', '.svg',
    ],
    platforms: ['ios', 'android', 'native'],
    preferNativePlatform: true,
    nodeModulesPaths: [
      join(__dirname, 'node_modules'),
      join(__dirname, '../../node_modules'),
    ],
  },
  transformer: {
    minifier: 'terser',
    inlineRequires: false,
    babel: {},
  },
  serializer: {
    polyfills: [],
    prelude: [],
    bundleType: 'plain',
    extraVars: {
      __BUNGAE__: true,
      'process.env.EXPO_ROUTER_APP_ROOT': './app',
      'process.env.EXPO_ROUTER_IMPORT_MODE': 'sync',
      'process.env.EXPO_OS': 'ios',
    },
  },
  server: {
    port: 8081,
    verifyConnections: false,
  },
} satisfies BungaeConfig);

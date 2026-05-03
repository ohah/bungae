/**
 * Bungae configuration for ExampleApp
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { withRozenite } from '@rozenite/metro';
// Use source files directly during development (avoid dist/index.js issues)
import { defineConfig } from 'bungae';
import type { BungaeConfig } from 'bungae';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = defineConfig({
  root: __dirname,
  entry: 'index.js',
  dev: true,
  minify: false,
  outDir: join(__dirname, '.bungae'),
  bundler: 'zts',
  resolver: {
    sourceExts: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json', '.svg'],
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
    babelTransformerPath: 'react-native-svg-transformer/react-native',
    babel: {},
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

// Wrap with Rozenite (Metro 호환). withRozenite는 server.enhanceMiddleware를
// 추가하여 /rozenite/* 라우트와 패치된 DevTools frontend(/rn_fusebox.html)를 서빙.
// Note: enabled를 명시하지 않으면 다음 버전부터 default로 비활성화되므로 명시 권장.
export default withRozenite(config as any, {
  enabled: true,
  // include: ['@rozenite/expo-atlas-plugin'], // optional: 명시적 플러그인 목록
});

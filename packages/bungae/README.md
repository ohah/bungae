# Bungae

A lightning-fast React Native bundler powered by Bun.

## Features

- ⚡ **Fast**: Built on Bun's native performance
- 🔧 **Metro Compatible**: Easy migration from Metro
- 📦 **TypeScript First**: Full TypeScript support
- 🎯 **Platform Support**: iOS, Android, and Web

## Installation

```bash
npm install --save-dev bungae
# or
bun add -d bungae
```

## Quick Start

### 1. Create a config file

Create `bungae.config.ts` in your project root:

```typescript
import { defineConfig } from 'bungae';

export default defineConfig({
  entry: 'index.js',
  platform: 'ios',
  dev: true,
});
```

### 2. Build

```bash
bungae build --platform ios
```

### 3. Development Server

```bash
bungae serve --platform ios
```

## Configuration

### Basic Config

```typescript
import { defineConfig } from 'bungae';

export default defineConfig({
  // Project root (default: process.cwd())
  root: './',

  // Entry file (default: 'index.js')
  entry: 'index.js',

  // Target platform
  platform: 'ios' | 'android' | 'web',

  // Development mode
  dev: true,

  // Enable minification
  minify: false,

  // Output directory (default: 'dist')
  outDir: 'dist',
});
```

### Advanced Config

```typescript
import { defineConfig } from 'bungae';

export default defineConfig({
  entry: 'index.js',
  platform: 'ios',

  resolver: {
    // Source file extensions
    sourceExts: ['.tsx', '.ts', '.jsx', '.js'],

    // Asset file extensions
    assetExts: ['.png', '.jpg', '.gif'],

    // Prefer .native.js over .js
    preferNativePlatform: true,
  },

  transformer: {
    // Babel configuration (optional)
    babel: {
      include: ['**/node_modules/react-native-reanimated/**'],
      plugins: ['react-native-reanimated/plugin'],
    },

    // Minifier
    minifier: 'bun', // 'bun' | 'terser' | 'esbuild'
  },

  serializer: {
    // Bundle type
    bundleType: 'plain', // 'plain' | 'ram-indexed' | 'ram-file'
  },
});
```

## CLI Options

```bash
bungae <command> [options]

Commands:
  build     Build the React Native bundle
  serve     Start the development server
  start     Alias for serve

Options:
  -h, --help       Show this help message
  -v, --version    Show version number
  -p, --platform   Target platform (ios, android, web)
  -d, --dev        Development mode
  -m, --minify     Enable minification
  -e, --entry      Entry file path
  -o, --outDir     Output directory
  -c, --config     Path to config file
  --root           Project root directory
```

## Programmatic API

```typescript
import { build, serve, loadConfig, resolveConfig } from 'bungae';

// Load and resolve config
const fileConfig = await loadConfig();
const config = resolveConfig(fileConfig);

// Build
await build(config);

// Serve
await serve(config);
```

## Platform Resolver

Bungae automatically resolves platform-specific files:

- `Button.ios.js` for iOS
- `Button.android.js` for Android
- `Button.native.js` for native platforms
- `Button.js` as fallback

## Migration from Metro

Bungae is designed to be Metro-compatible. Most Metro configs work with minimal changes:

```typescript
// metro.config.js (Metro)
module.exports = {
  resolver: {
    sourceExts: ['.tsx', '.ts', '.jsx', '.js'],
  },
};

// bungae.config.ts (Bungae)
import { defineConfig } from 'bungae';

export default defineConfig({
  resolver: {
    sourceExts: ['.tsx', '.ts', '.jsx', '.js'],
  },
});
```

## License

MIT

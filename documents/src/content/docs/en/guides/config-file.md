---
title: Config File
description: How to write bungae.config.ts and key options
---

## File Location

Place one of the following at the project root:

- `bungae.config.ts` (recommended)
- `bungae.config.js`
- `bungae.config.json`

Or use the `"bungae"` key inside `package.json`. Resolution priority is `.ts > .js > .json > package.json`.

You can scaffold one with `bungae init`.

## Minimal Config

```ts
// bungae.config.ts
import { defineConfig } from 'bungae';

export default defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
});
```

## Expo Projects

```ts
import { defineConfig, withExpo } from 'bungae';

export default withExpo(defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
}));
```

See [Expo integration](/bungae/guides/expo/) for what `withExpo()` adds.

## Key Options (full list in the [reference](/bungae/reference/config/))

```ts
defineConfig({
  // Required
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',

  // Mode
  dev: false,         // Same as CLI --dev
  minify: true,       // Same as CLI --minify

  // Output
  outDir: './dist',
  bundleOutput: './ios/main.jsbundle',
  sourceMap: true,
  sourcemapOutput: './ios/main.jsbundle.map',

  // Resolver
  resolver: {
    sourceExts: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
    assetExts: ['.png', '.jpg', '.svg', /* ... */],
    platforms: ['ios', 'android', 'native'],
    preferNativePlatform: true,
    nodeModulesPaths: [
      // Monorepo root
      join(__dirname, '../../node_modules'),
    ],
    blockList: [/\.test\./],
    extraNodeModules: {
      // Node built-in polyfills, etc.
      crypto: require.resolve('crypto-browserify'),
    },
    resolveRequest: (ctx, name, platform) => {
      // Custom resolution. Delegate via context.resolveRequest().
      if (name === 'foo') {
        return { type: 'sourceFile', filePath: '/abs/path/foo.js' };
      }
      return ctx.resolveRequest(ctx, name, platform);
    },
  },

  // Transformer
  transformer: {
    minifier: 'terser',  // 'bun' | 'terser' | 'esbuild' | 'swc'
    inlineRequires: false,
    babelTransformerPath: 'react-native-svg-transformer/react-native',
    babel: {
      // Chain user babel preset/plugins when needed
      presets: [],
      plugins: [],
    },
  },

  // Serializer
  serializer: {
    polyfills: [],
    prelude: [],
    bundleType: 'plain',
    extraVars: { __MY_FLAG__: true },
    inlineSourceMap: false,
    shouldAddToIgnoreList: (mod) => mod.path.includes('node_modules'),
    runBeforeMainModule: ['/abs/path/to/some-init.js'],
  },

  // Server
  server: {
    port: 8081,
    host: 'localhost',
    useGlobalHotkey: true,
    forwardClientLogs: true,
    enhanceMiddleware: (mw, server) => {
      // Wrap Connect middleware (e.g. withRozenite)
      return mw;
    },
    rewriteRequestUrl: (url) => url.replace('/old.bundle', '/index.bundle'),
    silentConsoleErrorPatterns: [],
  },

  // Symbolicator
  symbolicator: {
    customizeFrame: (frame) => {
      if (frame.file?.includes('react-native/')) return { collapse: true };
    },
  },

  // Experimental
  experimental: {
    treeShaking: false,
  },
});
```

## CLI Arguments Take Precedence

Arguments passed on the CLI such as `bungae bundle --platform ios --minify` override values from the config file.

## Config Validation

The config is automatically validated when you run `bungae bundle ...` or `bungae start ...`. Invalid options are surfaced as error messages.

## Migrating from a Metro Config

Most Metro config options work as-is under the same names. See [Migrating from Metro](/bungae/guides/migration/) for the detailed mapping.

---
title: Migrating from Metro
description: Move an existing Metro project to Bungae.
---

## TL;DR

> In most cases, just copy your `metro.config.js` options into `bungae.config.ts`. Or run `bungae init` to generate it automatically.

## Steps

### 1) Install

```bash
bun add bungae
```

### 2) Create the config

Automatic:

```bash
bun bungae init
```

→ Generates `bungae.config.ts` (auto-detects Expo) and adds `package.json` scripts.

Manual:

```ts
// bungae.config.ts
import { defineConfig } from 'bungae';
// For Expo:
// import { defineConfig, withExpo } from 'bungae';

export default defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
});
```

### 3) Map Metro options

Metro's `metro.config.js` options can be carried over directly.

```js
// Before: metro.config.js
const { getDefaultConfig } = require('@react-native/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('lottie');
config.resolver.sourceExts.push('mjs');
config.resolver.blockList = [/\.test\./];
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer');
config.server.port = 8082;

module.exports = config;
```

```ts
// After: bungae.config.ts
import { defineConfig } from 'bungae';

export default defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
  resolver: {
    assetExts: ['.lottie'],  // appended to Bungae's default list (deep merge)
    sourceExts: ['.mjs'],
    blockList: [/\.test\./],
  },
  transformer: {
    babelTransformerPath: 'react-native-svg-transformer',
  },
  server: {
    port: 8082,
  },
});
```

### 4) Update scripts

`package.json`:

```json
{
  "scripts": {
    "start": "bungae start",
    "bundle:ios": "bungae bundle --platform ios --minify"
  }
}
```

You can keep the existing RN CLI scripts and migrate gradually.

## Metro hook compatibility matrix

Most hooks share the same signature:

| Metro hook | Bungae | Notes |
| --- | --- | --- |
| `resolver.sourceExts` / `assetExts` / `platforms` | Same | |
| `resolver.blockList` | Same | RegExp array |
| `resolver.extraNodeModules` | Same | Fallback when normal resolution fails |
| `resolver.resolveRequest` | Same | Delegate via `context.resolveRequest()` |
| `resolver.nodeModulesPaths` | Same | Monorepo roots, etc. |
| `resolver.preferNativePlatform` | Same | |
| `transformer.babelTransformerPath` | Same | Chained transformer |
| `transformer.minifierPath` | Needs ZTS Zig work | Built-in minifier selection only |
| `transformer.getTransformOptions` | Needs ZTS Zig work | inlineRequires, etc. |
| `serializer.getModulesRunBeforeMainModule` | Same | InitializeCore included automatically |
| `serializer.getPolyfills` | Same | |
| `serializer.inlineSourceMap` | Same | base64 inline |
| `serializer.shouldAddToIgnoreList` | Same | Customize x_google_ignoreList |
| `serializer.customSerializer` | Not supported | RAM bundle is obsolete (replaced by Hermes) |
| `serializer.processModuleFilter` | Not supported | Workaround via `blockList` / `resolveRequest` |
| `serializer.createModuleIdFactory` | Not supported | ZTS path hashes are sufficient for CodePush compatibility |
| `server.enhanceMiddleware` | Same | Connect middleware wrapping |
| `server.rewriteRequestUrl` | Same | Called after jsc-safe normalize |
| `server.port` / `host` | Same | |
| `symbolicator.customizeFrame` | Same | Collapse frames in DevTools |
| `watchFolders` | Same | Watch directories outside the graph |
| `transformer.assetPlugins` | Not supported | Equivalent effect via `babelTransformerPath` |
| `cacheStores` | Not supported | Bungae uses its own PersistentCache |
| YAML config | Not supported | TypeScript / JS only |

For the full matrix, see the ZTS Metro Config Hook matrix in [CLAUDE.md](https://github.com/ohah/bungae/blob/main/CLAUDE.md).

## Expo projects

If you used `getDefaultConfig from '@expo/metro-config'` in Metro:

```ts
// In Bungae
import { defineConfig, withExpo } from 'bungae';

export default withExpo(defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
}));
```

`withExpo()` automatically adds the core ExpoMetroConfig options (winter, metro-runtime, expo-image/sqlite assetExts, .expo/types blockList). See [Expo integration](/bungae/guides/expo/) for details.

## Common differences

| In Metro | In Bungae |
| --- | --- |
| `metro.config.js` (CommonJS) | `bungae.config.ts` (ESM, TypeScript) |
| `getDefaultConfig from '@react-native/metro-config'` | Bungae defaults (applied automatically) |
| `getDefaultConfig from '@expo/metro-config'` | `withExpo()` |
| `npx react-native start` | `bungae start` |
| `npx react-native bundle ...` | `bungae bundle ...` (same CLI flags) |

## Gradual migration

You can keep both Metro and Bungae running side-by-side:

```json
{
  "scripts": {
    "start": "react-native start",
    "start:bungae": "bungae start",
    "bundle:ios": "react-native bundle --platform ios ...",
    "bundle:ios:bungae": "bungae bundle --platform ios ..."
  }
}
```

→ Once verified, swap the default to bungae.

## Sticking points

| Symptom | Fix |
| --- | --- |
| `Cannot find module` (RN library) | Add the monorepo root `node_modules` |
| `View config not found for component X` | RN 0.85+, rebuild with `--reset-cache` |
| Depending on `transformer.getTransformOptions` | ZTS work in progress. Wrap manually for now |
| Using a custom serializer | If it's for RAM bundle, switch to Hermes. Otherwise unsupported in Bungae |

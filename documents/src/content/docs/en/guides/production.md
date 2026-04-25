---
title: Production Builds
description: Generating release bundles and tuning optimization options.
---

## Basics

```bash
bungae bundle --platform ios --minify
```

Flag breakdown:

| Flag | Behavior |
| --- | --- |
| `--platform <ios\|android>` | Target platform (required) |
| `--minify` | Enable minification |
| `--dev false` | Production mode (Metro / RN CLI compatible) |
| `--bundle-output <path>` | Output file path (default: `outDir/main.jsbundle`) |
| `--sourcemap-output <path>` | Source map output |
| `--assets-dest <dir>` | iOS folder or Android `res/` |

## RN CLI integration

iOS:

```bash
bungae bundle --platform ios \
  --minify \
  --dev false \
  --entry-file index.js \
  --bundle-output ios/main.jsbundle \
  --assets-dest ios
```

Then run a Release build in Xcode → the JS bundle is embedded inside the `.app`.

Android:

```bash
bungae bundle --platform android \
  --minify \
  --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res
```

Then `./gradlew assembleRelease`.

## Choosing a minifier

```ts
// bungae.config.ts
transformer: {
  minifier: 'terser',  // default
}
```

| Option | Characteristics |
| --- | --- |
| `'terser'` | Metro default. Best compression, slowest |
| `'esbuild'` | 5–10x faster. Slightly worse compression |
| `'swc'` | Similar to esbuild. Balanced speed vs compression |
| `'bun'` | Bun built-in. Very fast, occasional compatibility issues |

Metro runtime functions (`__d`, `__r`, `__DEV__`) are reserved across all minifiers.

## Source maps

```bash
bungae bundle --platform ios --minify \
  --sourcemap-output ./ios/main.jsbundle.map \
  --sourcemap-sources-root /
```

DevTools maps stack traces to user code locations (e.g. `App.tsx:60`). `node_modules` is automatically added to the ignore list.

### Inline source map

```ts
serializer: {
  inlineSourceMap: true,  // base64-inlined into the bundle
}
```

→ Single-file output. Convenient for CodePush / OTA updates.

### Custom ignore list

```ts
serializer: {
  shouldAddToIgnoreList: (mod) => {
    if (mod.path.includes('/my-internal-pkg/')) return true;
    return mod.path.includes('node_modules');  // default
  },
}
```

## Tree-shaking (experimental)

```ts
experimental: {
  treeShaking: true,
}
```

Removes unused exports. Metro keeps this off because of dynamic require cases. CommonJS is safe; ESM named imports are risky. Read the [Tree Shaking guide](https://github.com/ohah/bungae/blob/main/CLAUDE.md#tree-shaking) before enabling.

## Cache

```bash
bungae bundle --reset-cache  # invalidate cache before build
```

Cache lives in `.bungae-cache/` (keyed by source file hash). Default expiry is 7 days.

## Measurements

ExampleApp (RN 0.85, 1595 files):

| Build | Time | Size |
| --- | --- | --- |
| Bungae prod minified | **2215 ms** | 3580 KB |
| Metro prod minified | 11547 ms | 2076 KB |
| Bungae dev | 2329 ms | 8235 KB |
| Metro dev | 12506 ms | 8437 KB |

Bungae's bundle is larger than Metro's due to differences in minifier aggressiveness. Further optimization is planned.

## CodePush / Expo Updates

ZTS's stable module IDs are compatible with OTA updates. No need to customize `createModuleIdFactory`.

---
title: Expo Integration
description: What withExpo() adds, plus zero-config auto-detection
---

Bungae supports Expo through an **explicit wrapper**, following the `getDefaultConfig` pattern from `@expo/metro-config`.

## Usage

### Explicit

```ts
import { defineConfig, withExpo } from 'bungae';

export default withExpo(
  defineConfig({
    root: __dirname,
    entry: 'index.js',
    bundler: 'zts',
  }),
);
```

### Zero config (no config file)

Bungae looks at your direct `package.json` dependencies and applies the wrapper automatically:

| Your `package.json` deps | Behavior                  | First-build log                                           |
| ------------------------ | ------------------------- | --------------------------------------------------------- |
| `expo` or `expo-router`  | Auto-applies `withExpo()` | `[bungae] expo: auto (detected expo@x.y)`                 |
| Otherwise                | Vanilla mode              | `[bungae] expo: off (no expo dependency in package.json)` |

Auto-detection only inspects **your own `package.json`** — a hoisted `expo` from another workspace package in a monorepo will not produce a false positive.

When an explicit config file exists, auto-detection is disabled — your config is the single source of truth.

## What `withExpo()` Adds

Following the `@expo/metro-config` mapping:

| Area                                | Added                                          |
| ----------------------------------- | ---------------------------------------------- |
| `serializer.runBeforeMainModule`    | `expo/winter/index`, `@expo/metro-runtime`     |
| `resolver.assetExts`                | `heic`, `avif`, `db` (expo-image, expo-sqlite) |
| `resolver.blockList`                | `/\.expo[\\/]types/` (generated `.d.ts`)       |
| `server.silentConsoleErrorPatterns` | iOS 26.4 winter polyfill warning               |

### `runBeforeMainModule` order

```
1. InitializeCore        (RN core, always first)
2. expo/winter/index     (WinterCG polyfills: TextEncoderStream, URL, etc.)
3. @expo/metro-runtime   (Location.install, fetch polyfill, etc.)
... user-specified modules (if any)
```

Each path is emitted by ZTS as its own outer guardedLoadModule layer, so a throw in one layer (e.g. the iOS 26.4 `Location` placeholder) does not block evaluation of the next.

### Pinning the `@expo/metro-runtime` instance

Resolution is anchored on `expo-router`'s `dirname`. In a monorepo, a hoisted `@expo/metro-runtime` may be a different instance and break the require chain — this ensures we pick up the same instance that `expo-router` requires.

## Monorepo Usage

When ExampleApp does not depend on `expo` directly but `expo` is hoisted to the workspace root:

- Bungae only looks at `dependencies` / `devDependencies` in your `package.json` and stays in vanilla mode
- Without calling `withExpo()`, no expo runtime is injected
- The expo runtime (e.g. `@expo/metro-runtime`) does not enter ExampleApp's build graph

A sibling ExpoApp in the same workspace will be auto-detected as long as `expo` is in its own `package.json`.

## Explicit vs Auto-Detection: Which Should I Use?

| Situation                       | Recommended                                            |
| ------------------------------- | ------------------------------------------------------ |
| First try, get going fast       | **Zero config** (auto-detection)                       |
| Team project, want explicitness | `bungae init` → explicit config file with `withExpo()` |
| Strict CI verification          | Explicit (no auto-detection magic)                     |

Auto-detection rarely makes the wrong call, but the upside of an explicit config is that "why is this build pulling in the expo runtime?" has an immediate answer when you debug.

## Adding Your Own Options

Options you specify are preserved alongside what `withExpo()` adds:

```ts
withExpo(
  defineConfig({
    resolver: {
      assetExts: ['.glb', '.gltf'], // appended on top of expo's heic/avif/db
      blockList: [/test\./], // appended on top of .expo/types
    },
    serializer: {
      runBeforeMainModule: ['/abs/path/early.js'], // runs before winter/metro-runtime
    },
  }),
);
```

`assetExts` is normalized to dot-prefix and deduplicated, so if you specify `.avif`, expo's `avif` is not added again.

## Implementation

- Wrapper: `packages/bungae/src/bundler/zts-bundler/withExpo.ts`
- Zero-config branch: `packages/bungae/cli/main.ts`
- Detection helper: `detectExpo(projectRoot)` (exported, usable directly)

The Bungae core (`napi-build.ts`) has no knowledge of expo — every expo-specific option lives inside `withExpo()`.

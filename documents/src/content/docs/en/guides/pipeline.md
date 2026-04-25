---
title: Bundling Pipeline
description: A deep dive into Resolution → Transformation → Serialization
---

`Entry → [Resolution] → [Transformation] → [Serialization] → Bundle`

## 1. Resolution

The ZTS resolver maps an import string to an absolute file path.

### Platform Resolver

React Native platform-specific extensions:

```
import './foo'
   ├ foo.ios.tsx     ← iOS build
   ├ foo.android.ts  ← Android build
   ├ foo.native.js   ← native (iOS/Android shared)
   └ foo.tsx         ← fallback
```

When `preferNativePlatform: true` (the default), `.native.*` slots in between platform-specific and generic variants:

```
iOS:    .ios.ts → .ios.tsx → .ios.js → .native.ts → .ts → .tsx → .js
```

### Hook Points

| Metro hook | Bungae mapping | Notes |
| --- | --- | --- |
| `resolver.resolveRequest` | Wrapped as a NAPI plugin | Can delegate via `context.resolveRequest()` |
| `resolver.extraNodeModules` | ZTS `fallback` | Applied only when normal resolution fails |
| `resolver.blockList` | ZTS `blockList` | Array of RegExps, blocked via regex match |
| `resolver.nodeModulesPaths` | Extra paths for the ZTS resolver | Monorepo roots, etc. |

## 2. Transformation

### ZTS native pass (most files)

A single-pass transpiler written in Zig:

| Input | Handling |
| --- | --- |
| `.ts` / `.tsx` | Strips TypeScript type annotations / interface / enum / decorators |
| `.jsx` / `.tsx` | JSX → `React.createElement` or the automatic runtime |
| `.js` (Flow) | Flow type stripping (ZTS's Flow mode) |
| Reanimated worklets | Transformed via the worklet AST plugin |

Babel is not in this path. Output is ES5 (Hermes-compatible) by default, or your configured target.

### NAPI plugin pass (specific files)

For things ZTS cannot handle natively or that are RN-specific transforms:

| Plugin | Targets | Responsibility |
| --- | --- | --- |
| `bungae:asset` | Images / video / audio / fonts (assetExts) | Generates `AssetRegistry.registerAsset()` and handles iOS scale variants (1x/2x/3x) |
| `bungae:codegen-view-config` | `*NativeComponent.{js,ts}` (RN 0.85+) | Calls `@react-native/babel-plugin-codegen` to inline the static view config |
| `bungae:require-context` | `require.context()` calls | Statically evaluates and inlines the matching modules |
| `bungae:metro-resolveRequest` | Every import | Invokes the user's `resolver.resolveRequest` |
| `bungae:babel` | When `transformer.babelTransformerPath` is set | Chains a user-provided babel transformer (e.g. svg-transformer) |

Each plugin is registered through ZTS's `onResolve` / `onLoad` / `onTransform` hooks. The NAPI hop costs roughly 0.05–0.3 ms per file.

### Incremental Native Migration

Areas where Babel still lingers (codegen view config, svg-transformer, …) are being moved to ZTS in stages:

| Phase | Status |
| --- | --- |
| Babel + Hermes Parser (Metro-equivalent) | Limited to a handful of files (NativeComponent codegen, etc.) |
| ZTS native + some Babel | **Current** |
| Fully native ZTS | In progress (native codegen — ohah/zts#1589, etc.) |

## 3. Serialization

### Plain Bundle (default)

Metro-compatible format:

```js
__d(function(global, _$$_REQUIRE, ..., module, exports) {
  // module code
}, /* moduleId */ 0, /* dependencies */ [1, 2, 3]);

__d(function(...) { ... }, 1, [...]);
// ...

__r(/* entry moduleId */ 42);
```

### prelude / polyfills / runBeforeMainModule

```
[prelude]                ← __BUNDLE_START_TIME__, __DEV__, process.env, etc.
[polyfills]              ← console.js, error-guard.js (IIFE)
[modules]                ← sequence of __d(fn, id, deps)
[runBeforeMainModule]    ← __r calls in order: InitializeCore → winter → metro-runtime
[__r(entry)]             ← user entry module
[footer]                 ← __BUNGAE_BUNDLER__, DevLoadingView.hide(), etc.
```

### Module ID Generation

Defaults to ZTS's path-hash-based stable ID. Compatible with CodePush and Expo Updates.

### Source Map

- `--source-map`: emits a separate `.map` file
- `serializer.inlineSourceMap`: base64-inlined into the bundle
- `x_google_ignoreList`: automatically excludes `node_modules` (customize with `shouldAddToIgnoreList`)

VLQ decoding uses the `vlq` package (same as Metro).

### What about RAM bundles?

Not supported. Hermes bytecode delivers equivalent lazy compilation, making RAM bundles obsolete. The RN docs say so explicitly: `If you are using Hermes, you should not need to use RAM bundles`.

## Where Bungae Diverges from Metro

See the [ZTS Metro Config Hook matrix](https://github.com/ohah/bungae/blob/main/CLAUDE.md). In short:

- Most hooks work with the same signature
- `transformer.getTransformOptions` (e.g. inlineRequires) needs work on the ZTS Zig side
- `serializer.customSerializer` is not supported — almost no use case beyond RAM bundles

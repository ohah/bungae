---
title: Plugin System
description: Authoring NAPI plugins, plus the built-ins
---

Bungae plugins use the ZTS NAPI plugin system as-is. The shape closely resembles esbuild's plugin API.

## Plugin Shape

```ts
import type { ZtsPlugin } from '@zts/core';

export function createMyPlugin(): ZtsPlugin {
  return {
    name: 'bungae:my-plugin',
    setup(build) {
      // resolution hook
      build.onResolve({ filter: /^foo:/ }, async (args) => {
        return { path: '/abs/path/foo.js' };
      });

      // load hook
      build.onLoad({ filter: /\.foo$/ }, async (args) => {
        return { contents: 'export default 42;', loader: 'js' };
      });

      // transform hook (parsed code)
      build.onTransform({ filter: /\.tsx$/ }, async (args) => {
        if (!args.code.includes('@my-marker')) return null;
        const transformed = doSomething(args.code);
        return { code: transformed };
      });
    },
  };
}
```

Each hook crosses NAPI to call your JS function. The hop is cheap, but on the hot path it runs once per file — keep them fast.

## Built-in Plugins

### `bungae:asset`

Files matching `assetExts` (`.png`, `.jpg`, `.svg`, …) are rewritten into RN `AssetRegistry.registerAsset()` calls:

```js
// foo.png → automatically transformed
module.exports = require("react-native/Libraries/Image/AssetRegistry").registerAsset({
  __packager_asset: true,
  scales: [1, 2, 3],
  hash: '...',
  name: 'foo',
  type: 'png',
  // ...
});
```

iOS 1x/2x/3x scale variants are handled automatically.

### `bungae:codegen-view-config`

When a `*NativeComponent.{js,ts}` file contains a `codegenNativeComponent<Props>('Name')` call, this plugin runs `@react-native/babel-plugin-codegen` to inline the view config as a static object:

```js
// Input (RN library code)
export default codegenNativeComponent<Props>('XxxView');

// Output (inlined view config)
export const __INTERNAL_VIEW_CONFIG = {
  uiViewClassName: 'XxxView',
  validAttributes: { /* ... */ },
  bubblingEventTypes: { /* ... */ },
};
export default NativeComponentRegistry.get('XxxView', () => __INTERNAL_VIEW_CONFIG);
```

A workaround for the RN 0.85+ Fabric `View config not found` crash.

### `bungae:require-context`

Statically evaluates `require.context(dir, recursive, regex)`. Used by expo-router's `_ctx.{ios,android,web}.tsx`. ZTS's import_scanner evaluator folds the arguments at build time.

### `bungae:metro-resolveRequest`

Wraps the user's `config.resolver.resolveRequest` hook as a ZTS `onResolve` callback. Called with the standard Metro signature (`context, moduleName, platform`).

### `bungae:babel`

When `transformer.babelTransformerPath` is set, this plugin chains the user's babel transformer. The integration point for common cases like `react-native-svg-transformer/react-native`.

## Adding User Plugins

Currently an internal API. We plan to expose `config.plugins?: ZtsPlugin[]` to users in the future. In the short term, `transformer.babelTransformerPath` (Babel) and `resolver.resolveRequest` (resolution) cover most needs.

## NAPI Hop Cost

| Hook | Call frequency | Recommendation |
| --- | --- | --- |
| `onResolve` | Every import (potentially tens of thousands) | Take the fast path first; minimize async |
| `onLoad` | When a new file is first read | Cache I/O |
| `onTransform` | Once per file | Memoize results by content hash |

`bungae:codegen-view-config` is a good template: it does a cheap `code.includes('codegenNativeComponent')` check before reaching for the heavier babel transform.

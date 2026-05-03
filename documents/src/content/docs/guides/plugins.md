---
title: 플러그인 시스템
description: NAPI 플러그인 작성 + 내장 플러그인
---

Bungae의 플러그인은 ZTS NAPI plugin 시스템을 그대로 사용합니다. esbuild의 plugin API와 유사한 형태.

## 플러그인 형태

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

각 hook은 ZTS native에서 NAPI를 통해 JS 함수를 호출하므로 hop 비용이 작지만, hot path에서 매 파일 호출되니 가능한 한 빠르게 끝나야 합니다.

## 내장 플러그인

### `bungae:asset`

`assetExts` 매칭 파일 (`.png`, `.jpg`, `.svg`, …)을 RN `AssetRegistry.registerAsset()` 호출로 변환:

```js
// foo.png → 자동 변환됨
module.exports = require('react-native/Libraries/Image/AssetRegistry').registerAsset({
  __packager_asset: true,
  scales: [1, 2, 3],
  hash: '...',
  name: 'foo',
  type: 'png',
  // ...
});
```

iOS 1x/2x/3x scale variant 자동 처리.

### `bungae:codegen-view-config`

`*NativeComponent.{js,ts}` 파일에서 `codegenNativeComponent<Props>('Name')` 호출을 발견하면 `@react-native/babel-plugin-codegen` 으로 view config를 static 객체로 인라인:

```js
// 입력 (RN 라이브러리 코드)
export default codegenNativeComponent<Props>('XxxView');

// 출력 (인라인된 view config)
export const __INTERNAL_VIEW_CONFIG = {
  uiViewClassName: 'XxxView',
  validAttributes: { /* ... */ },
  bubblingEventTypes: { /* ... */ },
};
export default NativeComponentRegistry.get('XxxView', () => __INTERNAL_VIEW_CONFIG);
```

RN 0.85+ Fabric의 `View config not found` 크래시 방지 워크어라운드.

### `bungae:require-context`

`require.context(dir, recursive, regex)` 정적 평가. expo-router의 `_ctx.{ios,android,web}.tsx`가 사용. ZTS의 import_scanner evaluator가 인자를 정적 평가.

### `bungae:metro-resolveRequest`

`config.resolver.resolveRequest` 사용자 hook을 ZTS `onResolve` 콜백으로 wrap. Metro 시그니처(`context, moduleName, platform`) 그대로 호출.

### `bungae:babel`

`transformer.babelTransformerPath` 가 지정된 경우 사용자 babel transformer를 chain. `react-native-svg-transformer/react-native` 같은 흔한 케이스를 위한 지점.

## 사용자 플러그인 추가

현재는 internal API. 향후 `config.plugins?: ZtsPlugin[]` 으로 사용자 노출 예정. 단기에는 `transformer.babelTransformerPath` (Babel) 또는 `resolver.resolveRequest` (해석)으로 대부분 cover 가능.

## NAPI hop 비용

| Hook          | 호출 빈도                  | 권장                         |
| ------------- | -------------------------- | ---------------------------- |
| `onResolve`   | 모든 import (수만 회 가능) | 빠른 path 우선, async 줄이기 |
| `onLoad`      | 새 파일 진입 시            | I/O 캐싱                     |
| `onTransform` | 매 파일 1회                | content hash로 결과 메모이즈 |

`bungae:codegen-view-config` 가 좋은 예시: `code.includes('codegenNativeComponent')` 로 가벼운 검사 후에만 무거운 babel transform 수행.

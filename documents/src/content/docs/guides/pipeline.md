---
title: 번들링 파이프라인
description: Resolution → Transformation → Serialization 3단계 자세히
---

`Entry → [Resolution] → [Transformation] → [Serialization] → Bundle`

## 1. Resolution (모듈 해석)

ZTS resolver가 import 문자열 → 절대 파일 경로로 해석합니다.

### Platform Resolver

React Native 플랫폼별 확장자:

```
import './foo'
   ├ foo.ios.tsx     ← iOS 빌드
   ├ foo.android.ts  ← Android 빌드
   ├ foo.native.js   ← native (iOS/Android 공통)
   └ foo.tsx         ← fallback
```

`preferNativePlatform: true` (기본) 시 `.native.*` 가 platform-specific 사이에 끼어듭니다:

```
iOS:    .ios.ts → .ios.tsx → .ios.js → .native.ts → .ts → .tsx → .js
```

### Hook 지점

| Metro hook                  | Bungae 매핑              | 비고                                 |
| --------------------------- | ------------------------ | ------------------------------------ |
| `resolver.resolveRequest`   | NAPI plugin으로 wrap     | `context.resolveRequest()` 위임 가능 |
| `resolver.extraNodeModules` | ZTS `fallback`           | 일반 해석 실패 시에만 적용           |
| `resolver.blockList`        | ZTS `blockList`          | RegExp 배열, 정규식 매칭으로 차단    |
| `resolver.nodeModulesPaths` | ZTS resolver의 추가 경로 | 모노레포 root 등                     |

## 2. Transformation (코드 변환)

### ZTS native pass (대부분의 파일)

Zig로 작성된 단일 패스 트랜스파일러:

| 입력               | 처리                                                           |
| ------------------ | -------------------------------------------------------------- |
| `.ts` / `.tsx`     | TypeScript 타입 어노테이션 / interface / enum / decorator 제거 |
| `.jsx` / `.tsx`    | JSX → `React.createElement` 또는 automatic runtime             |
| `.js` (Flow)       | Flow 타입 스트리핑 (ZTS의 Flow 모드)                           |
| Reanimated worklet | AST plugin으로 worklet 함수 변환                               |

Babel을 거치지 않습니다. 결과 코드는 ES5 (Hermes 호환) 또는 사용자 지정 target.

### NAPI plugin pass (일부 파일)

ZTS가 처리할 수 없거나 RN-specific transform:

| 플러그인                      | 대상                                       | 책임                                                                  |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `bungae:asset`                | 이미지/비디오/오디오/폰트 등 (assetExts)   | `AssetRegistry.registerAsset()` 생성. iOS scale variant (1x/2x/3x)    |
| `bungae:codegen-view-config`  | `*NativeComponent.{js,ts}` (RN 0.85+)      | `@react-native/babel-plugin-codegen` 호출 → static view config 인라인 |
| `bungae:require-context`      | `require.context()` 호출                   | 정적 평가 → 매칭되는 모듈 인라인                                      |
| `bungae:metro-resolveRequest` | 모든 import                                | 사용자의 `resolver.resolveRequest` 호출                               |
| `bungae:babel`                | `transformer.babelTransformerPath` 지정 시 | 사용자 babel transformer chain (svg-transformer 등)                   |

각 플러그인은 ZTS의 `onResolve` / `onLoad` / `onTransform` hook으로 등록됩니다. NAPI hop 비용은 파일당 0.05~0.3 ms 수준.

### 점진적 네이티브 전환

Babel이 일부 남아 있는 영역(codegen view config, svg-transformer 등)은 단계적으로 ZTS로 이관 중:

| Phase                              | 상태                                        |
| ---------------------------------- | ------------------------------------------- |
| Babel + Hermes Parser (Metro 동일) | 일부 파일만 (NativeComponent codegen 등)    |
| ZTS 네이티브 + 일부 Babel          | **현재**                                    |
| 완전 ZTS 네이티브                  | 진행 중 (codegen native — ohah/zts#1589 등) |

## 3. Serialization (번들 직렬화)

### Plain Bundle (기본)

Metro 호환 형식:

```js
__d(function(global, _$$_REQUIRE, ..., module, exports) {
  // 모듈 코드
}, /* moduleId */ 0, /* dependencies */ [1, 2, 3]);

__d(function(...) { ... }, 1, [...]);
// ...

__r(/* entry moduleId */ 42);
```

### prelude / polyfills / runBeforeMainModule

```
[prelude]                ← __BUNDLE_START_TIME__, __DEV__, process.env 등
[polyfills]              ← console.js, error-guard.js (IIFE)
[modules]                ← __d(fn, id, deps) 들의 sequence
[runBeforeMainModule]    ← __r 호출들 (InitializeCore, winter, metro-runtime 순)
[__r(entry)]             ← 사용자 entry 모듈
[footer]                 ← __BUNGAE_BUNDLER__, DevLoadingView.hide() 등
```

### Module ID 생성

기본은 ZTS의 path hash 기반 stable ID. CodePush / Expo Updates와 호환됩니다.

### Source Map

- `--source-map`: 별도 `.map` 파일
- `serializer.inlineSourceMap`: bundle 안 base64 인라인
- `x_google_ignoreList`: `node_modules` 자동 제외 (`shouldAddToIgnoreList`로 커스터마이즈 가능)

VLQ 디코딩은 vlq 패키지 (Metro 동일).

### RAM Bundle은?

지원하지 않습니다. Hermes 바이트코드가 동등한 lazy compilation을 내장하므로 obsolete. RN 공식 문서도 `If you are using Hermes, you should not need to use RAM bundles` 명시.

## Metro와 동등하지 않은 영역

[ZTS Metro Config Hook 매트릭스](https://github.com/ohah/bungae/blob/main/CLAUDE.md) 참고. 요점:

- ✅ 대부분의 hook은 동일 시그니처로 동작
- 🚧 `transformer.getTransformOptions` (inlineRequires 등): ZTS Zig 작업 필요
- ❌ `serializer.customSerializer`: RAM bundle 외에 거의 사용 안 됨, 미지원

---
title: Expo 통합
description: withExpo() 가 채우는 것 + zero-config 자동 감지
---

Bungae는 `@expo/metro-config` 의 `getDefaultConfig` 패턴을 따라 **명시적 wrapper** 로 Expo를 지원합니다.

## 사용법

### 명시 사용

```ts
import { defineConfig, withExpo } from 'bungae';

export default withExpo(defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
}));
```

### Zero config (config 파일 없음)

`package.json` 의 직접 의존성을 보고 자동 적용:

| 자기 `package.json` deps | 동작 | 첫 빌드 로그 |
| --- | --- | --- |
| `expo` 또는 `expo-router` | 자동으로 `withExpo()` 적용 | `[bungae] expo: auto (detected expo@x.y)` |
| 그 외 | vanilla 모드 | `[bungae] expo: off (no expo dependency in package.json)` |

자동 감지는 **자기 `package.json` 만** 봅니다 — 모노레포에서 다른 워크스페이스 패키지의 hoisted `expo` 는 false-positive를 만들지 않습니다.

명시적 config 파일이 있으면 자동 감지는 비활성화 — 사용자 config가 단일 진실의 원천.

## `withExpo()` 가 채우는 것

`@expo/metro-config` 의 매핑을 따라:

| 영역 | 추가 |
| --- | --- |
| `serializer.runBeforeMainModule` | `expo/winter/index`, `@expo/metro-runtime` |
| `resolver.assetExts` | `heic`, `avif`, `db` (expo-image, expo-sqlite) |
| `resolver.blockList` | `/\.expo[\\/]types/` (generated `.d.ts`) |
| `server.silentConsoleErrorPatterns` | iOS 26.4 winter polyfill warning |

### `runBeforeMainModule` 순서

```
1. InitializeCore        (RN core, 항상 first)
2. expo/winter/index     (WinterCG polyfill: TextEncoderStream, URL 등)
3. @expo/metro-runtime   (Location.install, fetch polyfill 등)
... 사용자가 명시한 모듈 (있다면)
```

각 path는 ZTS의 별 outer guardedLoadModule layer로 emit되므로 한 layer throw (예: iOS 26.4 `Location` placeholder)가 다음 layer 평가를 막지 않습니다.

### `@expo/metro-runtime` 인스턴스 보장

`expo-router` 의 `dirname` 기준으로 resolve합니다. monorepo에서 hoisted된 `@expo/metro-runtime` 이 별 instance인 경우 require chain이 깨질 수 있어, `expo-router` 가 require하는 동일 인스턴스를 잡기 위함입니다.

## 모노레포 사용

ExampleApp이 `expo` 의존성을 직접 갖지 않고, 워크스페이스 루트에 `expo` 가 hoisted된 경우:

- ✅ Bungae는 `package.json` 의 `dependencies` / `devDependencies` 만 보고 vanilla로 처리
- ✅ `withExpo()` 를 호출하지 않으면 expo runtime이 끼지 않음
- ✅ ExampleApp의 빌드 그래프에 `@expo/metro-runtime` 등이 들어가지 않음

같은 워크스페이스의 ExpoApp은 `expo` 가 자기 `package.json` 에 있으면 자동 감지.

## 명시 vs 자동 감지: 어느 쪽?

| 상황 | 권장 |
| --- | --- |
| 첫 시도, 빠르게 시작 | **Zero config** (자동 감지) |
| 팀 프로젝트, 명시성 원함 | `bungae init` → 명시 config 파일 + `withExpo()` 명시 |
| CI 환경 검증 강화 | 명시 (자동 감지의 마법성 제거) |

자동 감지가 잘못된 결정을 내리는 케이스는 거의 없지만, "왜 이 빌드가 expo runtime을 끼고 있지?" 가 디버깅 시 즉시 답이 나오는 게 명시 config의 장점입니다.

## 사용자가 직접 옵션 추가

`withExpo()` 가 추가하는 것에 더해 사용자가 명시한 옵션도 보존됩니다:

```ts
withExpo(defineConfig({
  resolver: {
    assetExts: ['.glb', '.gltf'],  // expo의 heic/avif/db에 더해 추가됨
    blockList: [/test\./],          // .expo/types에 더해 추가됨
  },
  serializer: {
    runBeforeMainModule: ['/abs/path/early.js'],  // winter/metro-runtime 앞에 옴
  },
}))
```

`assetExts` 는 dot prefix 정규화 후 dedup. 즉 사용자가 `.avif` 를 명시했다면 expo의 `avif` 는 다시 추가되지 않습니다.

## 구현 위치

- Wrapper: `packages/bungae/src/bundler/zts-bundler/withExpo.ts`
- Zero-config 분기: `packages/bungae/cli/main.ts`
- Detection helper: `detectExpo(projectRoot)` (export됨, 직접 사용 가능)

Bungae 본체 (`napi-build.ts`) 는 expo를 모릅니다 — 모든 expo-specific 옵션은 `withExpo()` 안에만 있습니다.

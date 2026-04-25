---
title: Metro에서 이관
description: 기존 Metro 프로젝트를 Bungae로 옮기기
---

## 한 줄 요약

> 대부분의 경우 `metro.config.js` 옵션을 `bungae.config.ts` 로 그대로 복사하면 끝. 또는 `bungae init` 으로 자동 생성.

## 단계

### 1) 설치

```bash
bun add bungae
```

### 2) Config 생성

자동:

```bash
bun bungae init
```

→ `bungae.config.ts` 자동 생성 (Expo 자동 감지). `package.json` scripts 추가.

수동:

```ts
// bungae.config.ts
import { defineConfig } from 'bungae';
// Expo면:
// import { defineConfig, withExpo } from 'bungae';

export default defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
});
```

### 3) Metro 옵션 매핑

Metro의 `metro.config.js` 옵션을 그대로 옮기면 됩니다.

```js
// 기존: metro.config.js
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
// 새: bungae.config.ts
import { defineConfig } from 'bungae';

export default defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
  resolver: {
    assetExts: ['.lottie'],  // bungae 기본 list에 추가됨 (deep merge)
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

### 4) Scripts 변경

`package.json`:

```json
{
  "scripts": {
    "start": "bungae start",
    "bundle:ios": "bungae bundle --platform ios --minify"
  }
}
```

기존 RN CLI는 그대로 두고 점진적으로 옮겨도 됩니다.

## Metro hook 호환 매트릭스

대부분 동일 시그니처:

| Metro hook | Bungae | 비고 |
| --- | --- | --- |
| `resolver.sourceExts` / `assetExts` / `platforms` | ✅ 동일 | |
| `resolver.blockList` | ✅ 동일 | RegExp 배열 |
| `resolver.extraNodeModules` | ✅ 동일 | 일반 해석 실패 시 fallback |
| `resolver.resolveRequest` | ✅ 동일 | `context.resolveRequest()` 위임 |
| `resolver.nodeModulesPaths` | ✅ 동일 | 모노레포 root 등 |
| `resolver.preferNativePlatform` | ✅ 동일 | |
| `transformer.babelTransformerPath` | ✅ 동일 | chained transformer |
| `transformer.minifierPath` | 🚧 ZTS Zig 작업 필요 | 내장 minifier 선택만 가능 |
| `transformer.getTransformOptions` | 🚧 ZTS Zig 작업 필요 | inlineRequires 등 |
| `serializer.getModulesRunBeforeMainModule` | ✅ 동일 | InitializeCore 자동 포함 |
| `serializer.getPolyfills` | ✅ 동일 | |
| `serializer.inlineSourceMap` | ✅ 동일 | base64 인라인 |
| `serializer.shouldAddToIgnoreList` | ✅ 동일 | x_google_ignoreList 커스터마이즈 |
| `serializer.customSerializer` | ❌ 미지원 | RAM bundle obsolete (Hermes로 대체) |
| `serializer.processModuleFilter` | ❌ 미지원 | `blockList` / `resolveRequest` 로 우회 |
| `serializer.createModuleIdFactory` | ❌ 미지원 | ZTS의 path hash가 CodePush 호환 충분 |
| `server.enhanceMiddleware` | ✅ 동일 | Connect 미들웨어 wrap |
| `server.rewriteRequestUrl` | ✅ 동일 | jsc-safe normalize 후 호출 |
| `server.port` / `host` | ✅ 동일 | |
| `symbolicator.customizeFrame` | ✅ 동일 | DevTools 프레임 collapse |
| `watchFolders` | ✅ 동일 | 그래프 밖 디렉토리도 watch |
| `transformer.assetPlugins` | ❌ 미지원 | `babelTransformerPath` 로 동등 효과 |
| `cacheStores` | ❌ 미지원 | Bungae 자체 PersistentCache |
| YAML config | ❌ 미지원 | TypeScript / JS 만 |

자세한 매트릭스는 [CLAUDE.md](https://github.com/ohah/bungae/blob/main/CLAUDE.md) 의 ZTS Metro Config Hook 매트릭스 참고.

## Expo 프로젝트

Metro에서 `getDefaultConfig from '@expo/metro-config'` 를 사용했다면:

```ts
// Bungae에서
import { defineConfig, withExpo } from 'bungae';

export default withExpo(defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
}));
```

`withExpo()` 가 ExpoMetroConfig의 핵심 옵션 (winter, metro-runtime, expo-image/sqlite assetExts, .expo/types blockList) 을 자동으로 추가. 자세한 동작은 [Expo 통합](/bungae/guides/expo/).

## 자주 발생하는 차이

| Metro에서 | Bungae에서 |
| --- | --- |
| `metro.config.js` (CommonJS) | `bungae.config.ts` (ESM, TypeScript) |
| `getDefaultConfig from '@react-native/metro-config'` | bungae 기본값 (자동 적용) |
| `getDefaultConfig from '@expo/metro-config'` | `withExpo()` |
| `npx react-native start` | `bungae start` |
| `npx react-native bundle ...` | `bungae bundle ...` (CLI 인자 동일) |

## 점진적 마이그레이션

Metro와 Bungae를 동시에 유지하면서 시도해볼 수 있습니다:

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

→ 검증 끝나면 default를 bungae로 교체.

## 막히는 곳

| 증상 | 해결 |
| --- | --- |
| `Cannot find module` (RN 라이브러리) | 모노레포 root `node_modules` 추가 |
| `View config not found for component X` | RN 0.85+, `--reset-cache` 후 재빌드 |
| `transformer.getTransformOptions` 의존 | ZTS 측 작업 진행 중. 임시로 wrap 필요 |
| Custom serializer 사용 중 | RAM bundle이라면 Hermes로 대체. 그 외는 Bungae에서 미지원 |

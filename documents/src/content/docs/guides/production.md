---
title: 프로덕션 빌드
description: 배포용 번들 생성 + 최적화 옵션
---

## 기본

```bash
bungae bundle --platform ios --minify
```

옵션 분해:

| 플래그 | 동작 |
| --- | --- |
| `--platform <ios\|android>` | 타겟 플랫폼 (필수) |
| `--minify` | 미니파이 활성 |
| `--dev false` | 프로덕션 모드 (Metro / RN CLI 호환) |
| `--bundle-output <path>` | 출력 파일 경로 (기본: `outDir/main.jsbundle`) |
| `--sourcemap-output <path>` | 소스맵 출력 |
| `--assets-dest <dir>` | iOS 폴더 또는 Android `res/` |

## RN CLI 통합

iOS:

```bash
bungae bundle --platform ios \
  --minify \
  --dev false \
  --entry-file index.js \
  --bundle-output ios/main.jsbundle \
  --assets-dest ios
```

이후 Xcode에서 Release 빌드 → JS 번들이 `.app` 안에 포함.

Android:

```bash
bungae bundle --platform android \
  --minify \
  --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res
```

이후 `./gradlew assembleRelease`.

## Minifier 선택

```ts
// bungae.config.ts
transformer: {
  minifier: 'terser',  // 기본
}
```

| 옵션 | 특징 |
| --- | --- |
| `'terser'` | Metro 기본. 최고 압축률, 가장 느림 |
| `'esbuild'` | 5~10x 빠름. 압축률 약간 손해 |
| `'swc'` | esbuild 비슷. 속도 vs 압축 균형 |
| `'bun'` | Bun 내장. 매우 빠름, 일부 케이스에서 호환성 이슈 |

Metro 런타임 함수 (`__d`, `__r`, `__DEV__`) 는 모든 minifier에서 reserved 처리.

## Source Map

```bash
bungae bundle --platform ios --minify \
  --sourcemap-output ./ios/main.jsbundle.map \
  --sourcemap-sources-root /
```

DevTools에서 stack trace가 사용자 코드 위치 (`App.tsx:60`) 로 매핑. `node_modules` 는 자동으로 ignore list.

### Inline source map

```ts
serializer: {
  inlineSourceMap: true,  // bundle 안에 base64 인라인
}
```

→ 파일 1개로 끝. CodePush / OTA 업데이트 시 편함.

### Custom ignore list

```ts
serializer: {
  shouldAddToIgnoreList: (mod) => {
    if (mod.path.includes('/my-internal-pkg/')) return true;
    return mod.path.includes('node_modules');  // 기본
  },
}
```

## Tree-shaking (실험적)

```ts
experimental: {
  treeShaking: true,
}
```

미사용 export 제거. Metro는 동적 require 케이스 때문에 비활성. CommonJS는 안전, ESM named import는 위험. 사용 전 [Tree Shaking 가이드](https://github.com/ohah/bungae/blob/main/CLAUDE.md#tree-shaking) 확인.

## 캐시

```bash
bungae bundle --reset-cache  # 캐시 무효화 후 빌드
```

캐시는 `.bungae-cache/` 에 저장 (소스 파일 hash 기준). 기본 만료 7일.

## 측정 결과

ExampleApp (RN 0.85, 1595 files):

| 빌드 | 시간 | 크기 |
| --- | --- | --- |
| Bungae prod minified | **2215 ms** | 3580 KB |
| Metro prod minified | 11547 ms | 2076 KB |
| Bungae dev | 2329 ms | 8235 KB |
| Metro dev | 12506 ms | 8437 KB |

Bungae 번들 크기가 Metro보다 큰 이유는 minifier aggressiveness 차이. 추후 최적화 예정.

## CodePush / Expo Updates

ZTS의 stable module ID로 OTA 업데이트와 호환. `createModuleIdFactory` 커스터마이즈 불필요.

---
title: 빠른 시작
description: 첫 dev session 부터 프로덕션 번들까지
---

`bungae`가 설치된 RN 프로젝트 기준 ([설치 가이드](/bungae/guides/installation/) 참고).

## 1) Dev Server 시작

```bash
bun bungae start --platform ios
```

다른 터미널에서 RN 앱 실행:

```bash
# iOS
bun ios
# Android
bun android
```

앱이 `http://localhost:8081/index.bundle?platform=ios` 를 fetch하고 첫 화면이 뜨면 성공.

### 단축키 (Metro 호환)

| 키  | 동작                  |
| --- | --------------------- |
| `r` | Reload (앱 리로드)    |
| `d` | Open Dev Menu         |
| `i` | Open iOS Simulator    |
| `a` | Open Android Emulator |
| `j` | Open Chrome DevTools  |
| `c` | Clear cache           |

## 2) 코드 변경 → HMR

`App.tsx` 수정 후 저장:

```tsx
export default function App() {
  return <Text>Hello, Bungae</Text>; // 수정
}
```

→ 앱 화면이 즉시 갱신. 컴포넌트 state는 보존 (Fast Refresh).

콘솔에 `console.log(...)` 추가하면 dev server 터미널에 즉시 출력 (console forwarding).

## 3) 프로덕션 번들 빌드

```bash
bun bungae bundle --platform ios --minify
```

출력:

```
✅ Bundle written to: .bungae/main.jsbundle
   Size: 3580 KB
   Bundler: Bungae v0.0.x
   Dev mode: false, Platform: ios
   📦 Copied to: ios/main.jsbundle
   ✅ iOS bundle ready for Xcode build
```

→ 그 다음 Xcode에서 Release 빌드, 또는 Gradle release.

## 4) Source Map / 디버깅

```bash
bun bungae bundle --platform ios --minify \
  --sourcemap-output ./ios/main.jsbundle.map
```

DevTools에서 stack trace가 사용자 코드 위치(`App.tsx:60`)로 정확히 매핑됩니다. `node_modules` 경로는 자동으로 ignore list에 들어가 디버깅 노이즈가 없습니다.

## 5) Expo 프로젝트라면

`bungae init` 또는 zero config 모드에서 자동 감지. 명시적으로:

```ts
// bungae.config.ts
import { defineConfig, withExpo } from 'bungae';

export default withExpo(
  defineConfig({
    root: __dirname,
    entry: 'index.js',
    bundler: 'zts',
  }),
);
```

자세한 동작은 [Expo 통합](/bungae/guides/expo/) 참고.

## 자주 막히는 곳

| 증상                                         | 원인 / 해결                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find module` (RN 라이브러리)         | 모노레포 root `node_modules` 추가: `resolver.nodeModulesPaths: [join(__dirname, '../../node_modules')]`                                     |
| `View config not found for component X`      | RN 0.85+ Fabric. Bungae가 자동으로 `@react-native/babel-plugin-codegen` 호출하므로 cache 무효화 후 재빌드: `bun bungae start --reset-cache` |
| Expo 관련 폴리필 미적용                      | `withExpo()` 래핑 안 함 또는 `package.json`에 `expo` 의존성 누락                                                                            |
| `silentConsoleErrorPatterns` warning 계속 뜸 | `withExpo()` 가 winter polyfill 패턴을 자동으로 추가. 수동으로 ServerConfig.silentConsoleErrorPatterns에도 가능                             |

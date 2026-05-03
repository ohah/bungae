---
title: 설치
description: Bungae 설치 + 첫 빌드 (5분 이내)
---

## 사전 요구사항

| 요구사항         | 버전                       |
| ---------------- | -------------------------- |
| **Bun**          | 1.3+                       |
| **React Native** | 0.74+ (0.85 권장)          |
| **Node.js**      | 20+ (CLI 일부 호환에 사용) |

iOS는 Xcode, Android는 Android Studio + Gradle은 평소대로 설치돼 있어야 합니다.

## 설치

```bash
bun add bungae
```

이게 끝입니다. peerDep으로 `react-native`, `@react-native/babel-preset` 등은 이미 RN 프로젝트에 있는 것을 사용합니다.

## 가장 빠른 시작 (Zero Config)

`bungae.config.ts` 파일 없이 바로 동작:

```bash
# dev server 시작
bun bungae start --platform ios

# 프로덕션 번들
bun bungae bundle --platform ios --minify
```

첫 빌드 로그에 자동 감지 결과가 표시됩니다:

```
[bungae] expo: auto (detected expo@55.0.0)
```

또는 vanilla RN인 경우:

```
[bungae] expo: off (no expo dependency in package.json)
```

→ `package.json`을 보고 `expo` / `expo-router` 직접 의존성이면 자동으로 `withExpo()` 통합 활성화. monorepo에서 hoisted 패키지 false-positive 없음.

## 명시적 config 파일 (권장)

Zero config가 동작하지만, 프로젝트가 커지면 명시 파일이 더 명확합니다:

```bash
bun bungae init
```

자동으로 `bungae.config.ts` 생성:

```
✓ wrote bungae.config.ts
  detected expo@55.0.0 → wrapped with withExpo()
✓ added "start:bungae" to package.json scripts
✓ added "build:bungae" to package.json scripts
✓ added .bungae/ to .gitignore

Done. Try `bungae start` or `bungae bundle --platform ios`.
```

생성된 파일:

```ts
// bungae.config.ts
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { defineConfig, withExpo } from 'bungae';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default withExpo(
  defineConfig({
    root: __dirname,
    entry: 'index.js',
    bundler: 'zts',
  }),
);
```

## CLI 단축키 등록 (선택)

`package.json`에서:

```json
{
  "scripts": {
    "start": "bungae start",
    "ios": "bun start --platform ios",
    "android": "bun start --platform android",
    "bundle:ios": "bungae bundle --platform ios",
    "bundle:android": "bungae bundle --platform android"
  }
}
```

→ `bungae init`이 `start:bungae` / `build:bungae`를 자동 추가하지만, RN CLI 기본 스크립트(`start`, `ios` 등)를 덮어쓰진 않으므로 필요하면 수동.

## 동작 검증

```bash
bun bungae start --platform ios
```

다음과 같은 출력이 나와야 합니다:

```
⚡ Bungae v0.0.x · Metro-compatible React Native bundler
[bungae] expo: ...
✓ ZTS native transformer ready
✓ Listening on http://localhost:8081
  Press r to reload, d for dev menu, j for DevTools

BUNDLE  [ios] ./index.js (1595 files, 8235.2 KB, 2329ms)
```

브라우저에서 `http://localhost:8081/index.bundle?platform=ios&dev=true` 가 200을 반환하면 정상.

## 다음 단계

- [빠른 시작](/bungae/guides/quick-start/) — 첫 dev session
- [설정 파일](/bungae/guides/config-file/) — 옵션 자세히
- [Expo 통합](/bungae/guides/expo/) — `withExpo()` 가 채우는 것

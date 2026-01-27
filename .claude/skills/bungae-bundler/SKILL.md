---
name: bungae-bundler
description: Bungae React Native 번들러 개발 가이드. 번들링 구현, 설정 시스템, 개발 서버, Babel 통합 등 번들러 개발 작업 시 참조. Resolution, Transformation, Serialization 파이프라인 구현 및 Metro 호환성 유지에 활용.
license: MIT
metadata:
  author: ohah
  version: '0.0.1'
---

# Bungae Bundler Development Guide

Bun 기반 React Native 번들러 개발을 위한 종합 가이드.
Metro 호환성을 유지하면서 Bun의 성능 이점을 최대한 활용.

## When to Apply

다음 작업 시 참조:

- 번들링 파이프라인 구현 (Resolution, Transformation, Serialization)
- 설정 시스템 구현 또는 수정
- 개발 서버 및 HMR 구현
- Babel 선택적 통합 작업
- 캐싱 및 최적화 구현
- Metro 호환성 관련 작업

## Rule Categories

| Category      | File                         | Description                            |
| ------------- | ---------------------------- | -------------------------------------- |
| Overview      | `rules/overview.md`          | 프로젝트 구조 및 로드맵                |
| Bundling      | `rules/bundling.md`          | 3단계 번들링 프로세스                  |
| Resolution    | `rules/resolution.md`        | 모듈 해석 전략 (Bun.build + Plugin)    |
| Config        | `rules/config.md`            | 설정 시스템 스키마                     |
| Transformer   | `rules/transformer.md`       | 코드 변환 및 Babel 통합                |
| Dev Server    | `rules/dev-server.md`        | 개발 서버 및 HMR                       |
| Incremental   | `rules/incremental-build.md` | 증분 빌드 시스템                       |
| Optimization  | `rules/optimization.md`      | 캐싱 및 성능 최적화                    |
| Bun APIs      | `rules/bun-apis.md`          | Bun API 활용 가이드                    |
| Bunup         | `rules/bunup.md`             | Bunup 빌드 도구 가이드                 |
| Testing       | `rules/testing.md`           | 테스트 코드 작성 가이드 (Metro 스타일) |
| Documentation | `rules/documentation.md`     | 문서 작성 가이드 (영어 기본 + 한국어)  |

## Quick Reference

### 기술 스택

| 항목        | 선택          | 이유                              |
| ----------- | ------------- | --------------------------------- |
| 런타임      | Bun           | 빠른 JS 런타임, 내장 트랜스파일러 |
| 빌드        | Bunup         | Bun 네이티브 라이브러리 빌드      |
| Lint/Format | oxlint, oxfmt | 빠른 린팅/포매팅                  |

**⚠️ Bunup 사용 시 주의사항**

bunup 관련 작업(설정, 옵션, 플러그인 등)을 할 때는 **반드시** 공식 웹 스펙 문서를 참조하세요:

- **공식 문서**: https://bunup.dev/docs/guide/options.html
- bunup의 옵션, 설정, 플러그인 시스템 등은 공식 문서를 기준으로 사용해야 합니다.
- 프로젝트 내부 문서보다 공식 스펙 문서가 최신이고 정확합니다.

### 번들링 3단계

```
Entry → [Resolution] → [Transformation] → [Serialization] → Bundle
```

1. **Resolution**: 모듈 경로 해석 (플랫폼별 확장자, node_modules)
2. **Transformation**: 코드 변환 (Bun 내장 우선, Babel 선택적)
3. **Serialization**: 번들 생성 (Plain, RAM Bundle)

### Transformer 전략: Metro 호환 변환 순서

Metro의 변환 파이프라인을 따르되, 각 도구가 가장 잘하는 작업을 담당:

```
1. Hermes Parser Plugin - Flow + JSX 파싱 (Babel only)
2. Flow Enum Transform   - Flow enum 처리 (Babel only)
3. Flow Type Stripping   - Flow 타입 제거 (Babel only)
4. ESM → CJS Conversion  - 모듈 변환 (SWC - fast)
5. JSX Transformation    - JSX 변환 (SWC - fast)
```

| 단계 | 도구           | 역할                | 이유                                |
| ---- | -------------- | ------------------- | ----------------------------------- |
| 1-3  | Babel + Hermes | Flow 파싱/타입 제거 | Hermes parser만 Flow 구문 처리 가능 |
| 4    | SWC            | ESM → CJS 변환      | Babel보다 빠름                      |
| 5    | SWC            | JSX 변환            | 빠른 JSX 변환                       |

### 점진적 Babel 제거 계획

현재 Flow 처리를 위해 Babel을 사용하지만, 장기적으로 Babel 의존성을 최소화할 계획:

- **Phase 1 (현재)**: Flow 파일용 Babel + SWC로 나머지 변환
- **Phase 2**: Hermes Parser 직접 통합 - Babel 없이 Hermes Parser AST 조작으로 Flow 타입 제거 구현
  - 참고: https://github.com/facebook/hermes/tree/main/lib/Parser
  - Hermes Parser는 React Native의 공식 파서로, Flow 구문을 네이티브 지원
  - Babel 의존성 제거 및 성능 향상 기대
- **Phase 3**: SWC Flow 지원 대기 (대안) 또는 전체 파이프라인을 SWC로 통합
- **Phase 4**: Babel은 특수 플러그인 필요 시에만 사용 (reanimated, styled-components 등)

### Babel이 필수인 케이스

| 라이브러리/기능         | 이유                 | 대안               |
| ----------------------- | -------------------- | ------------------ |
| Flow 코드               | Hermes parser만 가능 | SWC Flow 지원 대기 |
| react-native-reanimated | worklet 변환         | 대안 없음          |
| styled-components       | displayName 주입     | 대안 없음          |
| decorator 문법          | @observable 등       | 대안 없음          |

### 주요 Bun API

```typescript
Bun.file(); // 파일 I/O
Bun.serve(); // HTTP 서버
Bun.build(); // 번들링
Bun.Transpiler; // 코드 변환
```

## Implementation Roadmap

### Phase 1: 핵심 번들링 ✅ 완료

- [x] **Config 시스템** (플랫폼 정보 등 설정)
  - ✅ Config 로딩 (`bungae.config.ts/js/json`, `package.json`)
  - ✅ Config 병합 및 기본값 처리
  - ✅ Config 검증 로직
  - ✅ Server config 추가
  - ✅ Metro-compatible API (`loadConfig({ config, cwd })`)
  - ✅ Metro 스타일 테스트 코드 (11개 테스트 케이스)
- [x] **Platform Resolver Plugin** (`.ios.js`, `.android.js` 해석)
  - ✅ Bun Plugin으로 플랫폼 확장자 처리
  - ✅ `.ios.js`, `.android.js`, `.native.js` 지원
  - ✅ TypeScript 확장자 지원 (`.ios.tsx`, `.android.ts` 등)
  - ✅ `preferNativePlatform` 옵션 지원
- [x] **코드 변환 (Transformation)** - Bun.Transpiler 기본 + 선택적 Babel
  - ✅ Bun.Transpiler 기반 변환 구현
  - ✅ TypeScript/TSX/JSX → JavaScript 변환
  - ✅ 의존성 추출 (require, import, dynamic import)
  - ✅ Babel 선택적 통합
  - ✅ Metro 스타일 테스트 코드 (10개 테스트 케이스 모두 통과)
- [x] **Serialization** - Metro 호환 번들 형식
  - ✅ baseJSBundle 구현 (Metro 호환)
  - ✅ metro-runtime 번들 포함
  - ✅ prelude, polyfills 지원
  - ✅ `__d()`, `__r()` 형식 지원
  - ✅ 모듈 ID 생성 및 정렬
  - ✅ Source map URL 지원
  - ✅ SerializerOptions에 Metro 호환 옵션 추가
  - ✅ modulesOnly 옵션 구현 (prelude/runtime 제외)
  - ✅ inlineSourceMap 옵션 구현
  - ✅ x_google_ignoreList 생성 (shouldAddToIgnoreList)
  - ✅ InitializeCore 자동 감지 및 runBeforeMainModule 처리
  - ✅ sourceUrl, sourceMapUrl 옵션 사용 (개발 서버)
  - ✅ Metro 스타일 테스트 코드

**⚠️ Resolution 구현 전략**:

- Bun.build()의 기본 해석을 활용
- 플랫폼 확장자만 Plugin으로 추가 처리
- 완전히 새로 구현할 필요 없음

### Phase 2: 개발 환경 ✅ 완료

- [x] **증분 빌드 시스템** (핵심)
  - ✅ 의존성 그래프 - `graph.ts` (`buildGraph()`, `buildInverseDependencies()`)
  - ✅ 델타 계산기 - `hmr/delta.ts` (`calculateDelta()`, `hashModule()`)
  - ✅ 변환 캐시 - `cache.ts` (`PersistentCache` 클래스, 디스크 기반)
  - ✅ 증분 빌드 - `hmr/incremental.ts` (`incrementalBuild()`)
- [x] **개발 서버** - `server/index.ts` (Node.js http + Bun)
  - ✅ HTTP 서버 (번들 요청, 에셋 요청, 소스맵 요청)
  - ✅ WebSocket 서버 (HMR, DevTools)
  - ✅ @react-native/dev-middleware 통합
  - ✅ @react-native-community/cli-server-api 통합
- [x] **파일 감시** - `file-watcher.ts` (`createFileWatcher()`)
  - ✅ fs.watch 기반 재귀적 감시
  - ✅ 디바운싱 지원 (기본 300ms)
  - ✅ 원자적 쓰기 처리 (rename 이벤트)
- [x] **HMR** (Hot Module Replacement)
  - ✅ Metro 호환 HMR 프로토콜
  - ✅ WebSocket 기반 업데이트 전송
  - ✅ update-start / update / update-done 메시지
  - ✅ 에러 시 error 메시지 전송
- [x] **터미널 단축키** - `terminal-actions.ts`
  - ✅ `r` - Reload app
  - ✅ `d` - Open Dev Menu
  - ✅ `j` - Open DevTools
  - ✅ `i` - Open iOS Simulator
  - ✅ `a` - Open Android Emulator
  - ✅ `c` - Clear cache

**📌 함수 기반 구현 선택 이유:**

- 테스트 용이성 (순수 함수, 모킹 간단)
- 상태 격리 (테스트 간 상태 공유 없음)
- 의존성 명시적 (매개변수로 전달)

상세 구현: `rules/incremental-build.md`

### Phase 3: 최적화 ✅ 완료

- [x] **영구 캐싱** - `cache.ts` (`PersistentCache`)
  - ✅ 디스크 기반 캐시 (`.bungae-cache/`)
  - ✅ 캐시 만료 처리 (기본 7일)
  - ✅ 소스 파일 변경 감지
  - ✅ 2단계 디렉토리 구조 (대규모 프로젝트 지원)
- [x] **Minification** - `minify.ts`
  - ✅ Bun 내장 minifier (`Bun.build()`)
  - ✅ Terser (Metro 호환, 기본)
  - ✅ esbuild
  - ✅ SWC
  - ✅ Metro 런타임 함수 예약어 처리 (`__d`, `__r`, `__DEV__`)
- [x] **Tree Shaking** - `tree-shaking/`
  - ✅ `applyTreeShaking()` - 사용하지 않는 export 제거
  - ✅ `extractExports()` - export 분석
  - ✅ `extractImports()` - import 분석
  - ✅ `analyzeUsedExports()` - 사용 분석
  - ✅ `removeUnusedExports()` - AST에서 제거
  - ✅ `hasSideEffects()` - side effects 체크

### Phase 4: 고급 기능 (미구현)

- [ ] **Source Map 정확도 개선** - DevTools console.log 소스 위치 추론 정확도
- [ ] **RAM Bundle** - iOS/Android 최적화 번들 형식
- [ ] **플러그인 시스템** - 사용자 확장
- [ ] **require.context** - 동적 require 패턴
- [ ] **Lazy/Async 모듈** - code splitting (`import()` 번들 분리)
- [ ] **순환 참조 GC** - Bacon-Rajan 알고리즘
- [ ] **롤백 시스템** - 빌드 에러 시 이전 상태 복원

## Metro 호환성

### 구현 완료된 Metro 기능

다음 기능들은 Metro와 호환되도록 구현 완료되었습니다:

1. **inlineSourceMap 옵션** ✅
   - Source map을 번들 파일에 인라인으로 포함 (base64 인코딩)
   - 구현 위치: `serializer/helpers/getAppendScripts.ts`

2. **x_google_ignoreList 생성** ✅
   - Chrome DevTools에서 특정 소스 파일을 디버깅에서 제외
   - `shouldAddToIgnoreList` 옵션으로 커스텀 가능
   - 기본값: `node_modules/` 경로 파일 제외
   - 구현 위치: `graph-bundler/build/sourcemap.ts`

3. **Asset 지원** ✅
   - 이미지, 폰트 등 정적 자산을 번들에 포함
   - AssetRegistry 연동
   - 구현 위치: `graph-bundler/build/assets.ts`

4. **Fast Refresh** ✅
   - React Refresh 완전 지원
   - 의존성 그래프를 통해 자동 포함
   - Metro와 동일한 동작 방식

### 진행 중인 기능

1. **Source Map 정확도** ⚠️ 진행 중
   - 소스맵 생성은 구현됨
   - DevTools console.log 소스 위치 추론이 정확하지 않음
   - Metro와 동일한 정확도 달성 필요
   - 구현 위치: `graph-bundler/build/sourcemap.ts`

### 구현하지 않는 Metro 기능

다음 기능들은 Metro에 있지만 Bungae에서는 구현하지 않습니다:

#### 1. cacheStores (callback 패턴)

**Metro에서의 용도**:

- 변환 결과 캐싱을 위한 커스텀 캐시 백엔드 지원
- `cacheStores: (MetroCache) => [new CustomStore()]` 형태로 `MetroCache`를 주입받아 커스텀 스토어 생성
- FileStore 외에도 메모리 캐시, Redis 등 다양한 캐시 백엔드 지원

**Bungae에서 제외하는 이유**:

- Bun은 자체 캐시 시스템을 제공하거나 다른 방식으로 캐시를 관리할 수 있음
- 롤리팝도 자체 캐시 시스템(`FileSystemCache`)을 사용하며 Metro의 `cacheStores` 패턴을 사용하지 않음
- Bun의 내장 기능을 활용하는 것이 더 효율적

#### 2. YAML config 지원

**Metro에서의 용도**:

- 레거시 프로젝트 호환성: 과거에 YAML config를 사용하던 프로젝트 지원
- **Deprecated 상태**: 경고 메시지를 표시하며 JavaScript config로 마이그레이션을 권장

**Bungae에서 제외하는 이유**:

- 레거시 지원이 필요 없음 (새로운 프로젝트)
- JavaScript/TypeScript config만 지원해도 충분
- 롤리팝도 YAML을 지원하지 않음
- Metro에서도 deprecated 상태이므로 새 프로젝트에서 구현할 필요 없음

**참고**: Metro 코드에서 YAML 지원은 다음과 같이 deprecated 처리되어 있습니다:

```javascript
console.warn(
  'YAML config is deprecated, please migrate to JavaScript config (e.g. metro.config.js)',
);
```

## Reference

- Metro: `reference/metro/packages/`
- Rollipop: `reference/rollipop/packages/rollipop/`

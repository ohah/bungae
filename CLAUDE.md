# Bungae - Metro 호환 React Native 번들러

Bun 기반 React Native 번들러로, Metro와 호환되면서 더 나은 성능을 제공합니다.

## 핵심 원칙

1. **Metro 호환성 우선**: 기존 Metro 프로젝트가 최소한의 변경으로 마이그레이션 가능
2. **성능 최우선**: Bun의 성능 이점을 최대한 활용하여 빌드 속도 개선
3. **점진적 개선**: 핵심 기능부터 구현하고 점진적으로 확장
4. **Bun 네이티브 우선**: 가능한 한 Bun 내장 API 활용

## 번들러 선택

Bungae는 세 가지 번들러 구현을 제공합니다:

| 번들러  | 설명                      | 상태               | 사용 시기                     |
| ------- | ------------------------- | ------------------ | ----------------------------- |
| `graph` | Babel 기반, Metro 호환    | **기본값 (안정)**  | 프로덕션, 모든 RN 프로젝트    |
| `bun`   | Bun.Transpiler 기반       | 보류               | 구현 예정 없음                |
| `oxc`   | Rolldown 기반, ESM 번들링 | **개발 환경 완료** | ESM 번들링, HMR, Fast Refresh |

### 설정 방법

```typescript
// bungae.config.ts
export default {
  bundler: 'oxc', // 'graph' (기본값) 또는 'bun' 또는 'oxc'
  // ...
};
```

### 번들러 비교

| 기능            | graph-bundler (Babel) | bun-bundler (Bun.Transpiler)        |
| --------------- | --------------------- | ----------------------------------- |
| TypeScript 변환 | Babel (느림)          | Bun.Transpiler (10-100x 빠름)       |
| Flow 변환       | hermes-parser + Babel | hermes-parser + Babel (동일)        |
| 의존성 추출     | @babel/traverse       | Bun.Transpiler.scanImports() (빠름) |
| JSX 변환        | Babel                 | Bun.Transpiler (빠름)               |
| Metro 호환성    | 완전 호환             | 완전 호환                           |
| 안정성          | 검증됨                | 실험적                              |

### 구현 위치

```
bundler/
├── index.ts              # 분기 로직 (config.bundler에 따라 선택)
├── graph-bundler/        # Babel 기반 (기본, 안정)
│   ├── graph.ts          # 의존성 그래프 빌드
│   ├── transformer.ts    # Babel 변환
│   └── ...
├── bun-bundler/          # Bun.Transpiler 기반 (빠름, 실험적)
│   ├── graph.ts          # Bun.Transpiler로 의존성 그래프 빌드
│   ├── transformer.ts    # Bun.Transpiler 변환
│   └── ...
└── oxc-bundler/          # Rolldown 기반 (ESM, HMR 지원)
    ├── bundler.ts        # Rolldown 빌드 + 공유 옵션
    ├── plugins/          # Rolldown 플러그인
    │   ├── hermes-compat.ts  # SWC es5 다운레벨 (Hermes 호환)
    │   ├── flow-strip.ts     # Flow 타입 제거 (Babel)
    │   ├── hmr-client-replace.ts  # metro-runtime HMRClient 교체
    │   └── react-refresh.ts  # React Refresh 경계 래핑
    ├── hmr/              # HMR 시스템
    │   ├── dev-engine.ts     # Rolldown DevEngine 래퍼
    │   ├── hmr-client.ts     # metro-runtime API 호환 HMR 클라이언트
    │   └── runtime.ts        # DevEngine 런타임 (모듈 등록, 패치 실행)
    └── server/           # 개발 서버
        └── index.ts      # HTTP + WebSocket HMR 서버
```

## 번들링 프로세스

3단계 파이프라인: `Entry → [Resolution] → [Transformation] → [Serialization] → Bundle`

### Resolution (모듈 해석)

- **자체 모듈 해석**: `require.resolve()` 기반 모듈 해석
- **Platform Resolver**: React Native 플랫폼 확장자 (`.ios.js`, `.android.js`, `.native.js`) 처리
- **구현 위치**: `graph-bundler.ts`의 `resolveModule()` 함수

### Transformation (코드 변환)

#### graph-bundler (기본값, Babel 기반)

**Metro와 동일하게 Babel + Hermes Parser 사용**

```
Entry → Hermes Parser (Flow 파싱) → @react-native/babel-preset (모든 변환) → Output
```

| 도구                       | 역할                                           |
| -------------------------- | ---------------------------------------------- |
| Hermes Parser              | Flow 구문 파싱 (Metro와 동일)                  |
| @react-native/babel-preset | Flow 제거, JSX 변환, ESM→CJS 변환 (all-in-one) |

**구현 위치**: `graph-bundler/transformer.ts`

#### bun-bundler (실험적, Bun.Transpiler 기반)

**TypeScript/JSX는 Bun.Transpiler, Flow는 hermes-parser 폴백**

```
TypeScript/JSX → Bun.Transpiler (10-100x 빠름) → Output
Flow/JS       → Hermes Parser + Babel (폴백) → Output
```

| 파일 유형             | 변환기                | 속도         |
| --------------------- | --------------------- | ------------ |
| .ts, .tsx             | Bun.Transpiler        | 매우 빠름    |
| .js, .jsx (Flow 없음) | Bun.Transpiler        | 매우 빠름    |
| .js (Flow 구문 포함)  | hermes-parser + Babel | Babel과 동일 |

**의존성 추출**: `Bun.Transpiler.scanImports()` 사용 (AST 순회 없이 빠른 추출)

**구현 위치**: `bun-bundler/transformer.ts`

#### 점진적 네이티브 전환 계획

**전략**: Metro와 동일하게 동작하면서 점진적으로 Babel → 네이티브로 교체

```
Phase 1+ (현재): Babel + Hermes Parser (Metro 동일)
     ↓
Phase 2: Hermes Parser + SWC (Babel 일부 제거)
     ↓
Phase 3: Hermes Parser + Bun.Transpiler (Babel 최소화)
     ↓
Phase 4: Bun 네이티브
```

**교체 대상 (우선순위순)**:

1. **ESM → CJS 변환**: `@babel/plugin-transform-modules-commonjs` → SWC
2. **JSX 변환**: `@babel/preset-react` → SWC 또는 Bun.Transpiler
3. **Flow 타입 제거**: `@babel/plugin-transform-flow-strip-types` → Hermes Parser 직접 조작
4. **기타 변환**: 개별 Babel 플러그인 → SWC 플러그인

**검증 방식**: Metro 벤치마킹 테스트

- Metro 번들과 Bungae 번들을 동일 입력으로 생성
- 번들 출력 비교 (구조, 모듈 순서, 코드)
- 성능 비교 (빌드 시간, 번들 크기)
- React Native 앱에서 실제 동작 테스트

### Serialization (번들 직렬화)

- Plain Bundle (기본)
- RAM Bundle (Indexed/File) - 레거시 최적화, Hermes 사용 시 불필요

## Bun API 활용

```typescript
// ✅ 현재 사용 중
Bun.serve(); // HTTP 서버 + WebSocket (HMR)
Bun.file(); // 파일 I/O

// ✅ bun-bundler에서 사용 중 (config.bundler: 'bun')
Bun.Transpiler; // 코드 변환 (TypeScript/JSX)
Bun.Transpiler.scanImports(); // 의존성 추출 (매우 빠름)

// 🔄 향후 사용 예정
Bun.build(); // 전체 번들링 (현재는 자체 그래프 빌더 사용)
Bun.worker(); // 병렬 처리
Bun.hash(); // 캐시 키 생성
```

## 코드 작성 가이드

- TypeScript 엄격 모드 사용
- 에러 메시지는 명확하고 도움이 되도록 작성
- 각 모듈별 독립 테스트 작성
- JSDoc 주석으로 API 문서화
- Metro와 유사한 에러 형식 유지

## 성능 목표

- 초기 빌드: Metro 대비 2-3배 빠름
- 증분 빌드: 캐시 효율로 재빌드 시간 단축
- 번들 크기: Tree-shaking으로 10-20% 감소
- 메모리: 대규모 프로젝트에서도 안정적

## 구현 현황

### Phase 1: 핵심 번들링

#### ✅ 완료된 기능

1. **Config 시스템** (Phase 1-1)
   - Config 파일 로딩 (`bungae.config.ts/js/json`, `package.json`)
   - Config 병합 및 기본값 처리
   - Config 검증 로직 (타입 및 값 검증)
   - Server config 추가 (port, useGlobalHotkey, forwardClientLogs 등)
   - Metro-compatible API (`loadConfig({ config, cwd })`)
   - Metro 스타일 테스트 코드 (11개 테스트 케이스 모두 통과)

2. **Platform Resolver Plugin** (Phase 1-2)
   - Bun Plugin으로 플랫폼 확장자 처리
   - `.ios.js`, `.android.js`, `.native.js` 지원
   - TypeScript 확장자 지원 (`.ios.tsx`, `.android.ts` 등)
   - `preferNativePlatform` 옵션 지원
   - 테스트 코드 작성 완료 (5개 테스트 케이스 모두 통과)

3. **코드 변환 (Transformation)** (Phase 1-3 → Phase 1+)
   - **현재**: Babel + Hermes Parser 기반 변환 (Metro 동일)
   - @react-native/babel-preset 사용 (Metro와 동일한 변환)
   - TypeScript/TSX/JSX/Flow → JavaScript 변환
   - 의존성 추출 (require, import, dynamic import)
   - Metro 스타일 테스트 코드 통과
   - **미사용 코드 보관**: `bun-transformer.ts`, `swc-transformer.ts` (향후 최적화용)

4. **Serialization** (Phase 1-3)
   - baseJSBundle 구현 (Metro 호환)
   - metro-runtime 번들 포함
   - prelude, polyfills 지원
   - **d(), **r() 형식 지원
   - 모듈 ID 생성 및 정렬
   - Source map URL 지원
   - Metro 스타일 테스트 코드 (15개 테스트 케이스 모두 통과)

### Phase 2: 개발 환경

#### ✅ 완료된 기능

1. **증분 빌드 시스템** (Phase 2-1)
   - `incrementalBuild()` 함수 구현
   - 파일 변경 시 영향받은 모듈만 재빌드
   - 이전 그래프와 새 그래프 간 델타 계산 (`calculateDelta()`)
   - 역의존성 그래프를 통한 영향받은 모듈 추적 (`getAffectedModules()`)
   - 모듈 ID 일관성 유지 (동일한 `createModuleId` 팩토리 재사용)
   - 플랫폼별 빌드 상태 관리 (다중 플랫폼 HMR 지원)
   - 구현 위치: `graph-bundler.ts`의 `incrementalBuild()` 함수

2. **개발 서버** (Phase 2-2)
   - `serveWithGraph()` 함수 구현
   - Node.js http + Bun 기반 HTTP 서버
   - 번들 요청 처리 (`/index.bundle?platform=ios&dev=true`)
   - WebSocket 지원 (HMR용)
   - 플랫폼별 번들 캐싱
   - @react-native/dev-middleware 통합
   - @react-native-community/cli-server-api 통합
   - 구현 위치: `graph-bundler/server/index.ts`

3. **HMR (Hot Module Replacement)** (Phase 2-3)
   - **Metro 호환 HMR 프로토콜**: React Native의 내장 HMRClient와 호환
   - `buildWithGraph()` 함수가 HMR 상태 관리를 위해 graph와 `createModuleId` 반환
   - Metro HMR 메시지 형식 구현:
     - `update-start` / `update-done`: 업데이트 생명주기
     - `update`: 추가/수정/삭제된 모듈 정보
     - `error`: 빌드 실패 시 에러 전송
   - `createHMRUpdateMessage()`: Metro 호환 HMR 업데이트 메시지 생성
   - 모듈 ID 일관성: 빌드 간 동일한 `createModuleId` 팩토리 재사용
   - 역의존성 그래프: React Refresh 경계를 위한 Metro의 상향 순회 패턴 지원
   - 다중 플랫폼 HMR: iOS/Android 각각 독립적인 HMR 업데이트
   - 구현 위치: `graph-bundler.ts`의 HMR 관련 함수들
   - 테스트 코드 작성 완료 (15개 이상의 테스트 케이스 모두 통과)

4. **React Refresh (Fast Refresh)** (Phase 2-3)
   - 완전 지원 (의존성 그래프를 통해 자동 포함)
   - Metro와 동일한 동작 방식

5. **파일 감시** (Phase 2-4)
   - `file-watcher.ts` 모듈 구현
   - 파일 변경 감지 및 HMR 트리거
   - 원자적 쓰기 처리 (VSCode 등 에디터의 rename 이벤트)
   - JS/TS/JSON 소스 파일만 처리하도록 필터링
   - 디바운싱 지원 (기본 300ms)
   - 구현 위치: `file-watcher.ts`의 `createFileWatcher()` 함수

6. **터미널 단축키** (Phase 2-5) ✅
   - Metro 호환 터미널 단축키 지원
   - `r` - Reload (앱 리로드)
   - `d` - Open Dev Menu (개발 메뉴 열기)
   - `i` - Open iOS Simulator
   - `a` - Open Android Emulator
   - `j` - Open Chrome DevTools
   - `c` - Clear cache
   - `useGlobalHotkey` 설정 옵션 지원 (기본값: true)
   - 구현 위치: `graph-bundler/terminal-actions.ts`

#### HMR (Hot Module Replacement) 구현 전략

**결정: Metro HMRClient 호환 방식 채택**

React Native의 기본 HMRClient.js를 그대로 사용하고, Bungae 서버가 Metro HMR 프로토콜을 구현합니다.

```
┌─────────────────────────────────────────────────────────┐
│  Bungae Dev Server                                      │
│  - 파일 변경 감지 → 재번들링                              │
│  - Metro HMR 프로토콜로 WebSocket 메시지 전송             │
└─────────────────────────────────────────────────────────┘
                    ↕ WebSocket (Metro 프로토콜)
┌─────────────────────────────────────────────────────────┐
│  React Native App                                       │
│  - HMRClient.js (React Native 기본 제공, 수정 없음)       │
│  - 업데이트 수신 및 적용                                  │
└─────────────────────────────────────────────────────────┘
```

**Metro HMR 프로토콜 메시지 형식:**

```typescript
// 서버 → 클라이언트
{
  type: 'update',
  body: {
    revisionId: string,
    isInitialUpdate: boolean,
    added: Array<{ module: [number, string], sourceURL: string, sourceMappingURL?: string }>,
    modified: Array<{ module: [number, string], sourceURL: string, sourceMappingURL?: string }>,
    deleted: number[]
  }
}
```

**이 방식을 선택한 이유:**

| 항목           | Metro 호환 (채택)      | 자체 구현 (롤리팝 방식)     |
| -------------- | ---------------------- | --------------------------- |
| 초기 구현 비용 | 낮음                   | 높음                        |
| 유지보수       | RN 업데이트 자동 반영  | RN 업데이트마다 호환성 확인 |
| 마이그레이션   | 쉬움                   | 설정 필요                   |
| 에코시스템     | Flipper, DevTools 호환 | 별도 대응 필요              |

1. **Metro 호환성 원칙과 일치** - 기존 프로젝트 최소 변경으로 마이그레이션
2. **구현 범위 최소화** - HMRClient 구현 불필요, 서버 프로토콜만 구현
3. **React Native 업그레이드 대응 용이** - 프로토콜만 유지되면 내부 변경에 영향 없음
4. **에코시스템 호환** - 기존 개발 도구들과 호환

**참고 - 롤리팝의 접근 방식:**

- 롤리팝은 자체 HMR 프로토콜(`hmr:update`, `hmr:reload` 등)을 사용
- Rolldown 플러그인으로 `react-native/Libraries/Utilities/HMRClient.js`를 자체 구현으로 교체
- 프로토콜 자유도는 높지만 RN 업데이트마다 호환성 검증 필요

**향후 고려사항:**

- Metro 프로토콜의 한계가 느껴지면 자체 HMR 클라이언트 검토
- 더 효율적인 업데이트 전송이 필요한 경우
- Metro에 없는 HMR 기능이 필요한 경우

#### React Refresh (Fast Refresh) 지원

**완전 지원**: 의존성 그래프를 통해 `setUpReactRefresh` 모듈이 자동 포함되며, Metro와 동일하게 컴포넌트 상태를 유지하면서 코드 변경을 반영합니다.

#### ✅ Phase 2-3에서 구현 완료된 기능

다음 기능들은 Metro 호환으로 구현 완료되었습니다:

1. **inlineSourceMap 옵션** ✅
   - Source map을 번들 파일에 인라인으로 포함 (base64 인코딩)
   - 구현 위치: `serializer/helpers/getAppendScripts.ts`

2. **x_google_ignoreList 생성** ✅
   - Chrome DevTools에서 특정 소스 파일을 디버깅에서 제외
   - `shouldAddToIgnoreList` 옵션으로 커스텀 가능
   - 기본값: `node_modules/` 경로 파일 제외
   - 구현 위치: `graph-bundler/build/sourcemap.ts`

#### ✅ Source Map 정확도 (완료)

- DevTools console.log가 사용자 코드 위치 (예: `App.tsx:60`)를 올바르게 표시
- `x_google_ignoreList`가 정상 작동하여 console.js 등 폴리필 건너뜀
- vlq 패키지로 Babel 소스맵 직접 VLQ 디코딩 (Metro 동일)
- 구현 위치: `graph-bundler/build/sourcemap.ts`

### Phase 3: 최적화 ✅ 완료

1. **영구 캐싱** ✅
   - `PersistentCache` 클래스 구현 (`cache.ts`)
   - 디스크 기반 캐시 (`.bungae-cache/`)
   - 캐시 만료 처리 (기본 7일)
   - 소스 파일 변경 감지

2. **Minification** ✅
   - `minify.ts` 구현
   - Bun 내장 minifier, Terser, esbuild, SWC 지원
   - Metro 런타임 함수 예약어 처리 (`__d`, `__r`, `__DEV__`)

3. **Tree Shaking** ✅
   - `tree-shaking/` 폴더 구현
   - `applyTreeShaking()` - 사용하지 않는 export 제거
   - `extractExports()`, `extractImports()` - import/export 분석
   - `hasSideEffects()` - side effects 체크

### Phase 4: Bun.Transpiler 최적화 ⏸️ 보류

`config.bundler: 'bun'` — graph-bundler의 Bun.Transpiler 최적화 버전.
OXC 번들러(Rolldown)에 집중하기 위해 추가 개발 보류.

### OXC 번들러 (Rolldown 기반) — 메인 개발 대상

`config.bundler: 'oxc'` 옵션으로 선택 가능.

Rolldown을 사용한 ESM 기반 React Native 번들링. graph-bundler와 달리 CJS 래핑 없이 ESM 모듈 그대로 번들링합니다.
핵심 번들링 + 개발 환경(HMR, React Refresh) 완료.

#### Phase 1: 핵심 번들링 ✅

- Rolldown `strictExecutionOrder`로 ESM 모듈 실행 순서 보장
- 플러그인: flow-strip, asset, json, platform-resolver, prelude, hermes-compat
- Hermes 바이트코드 컴파일 지원
- 구현 위치: `bundler/oxc-bundler/`

#### Phase 2: 개발 환경 ✅

- **개발 서버**: HTTP + WebSocket HMR
- **HMR**: Rolldown DevEngine Patch HMR (변경 모듈만 패치 전송, 상태 보존)
- **React Refresh**: `import.meta.hot.accept()` 경계 래핑, Fast Refresh 지원
- **HMR 클라이언트**: metro-runtime HMRClient API 호환 (`new HMRClient(url)` + 이벤트 기반)
- **모듈 등록**: DevEngine에 클라이언트 모듈 등록 → 정확한 패치 생성
- **터미널 단축키**: graph-bundler 재사용

#### Hermes 호환성: hermes-compat 플러그인 ✅ 해결됨

`hermes-compat` 플러그인은 Rolldown 출력을 Hermes/React Native에서 실행 가능하도록 후처리합니다.
구현 위치: `oxc-bundler/plugins/hermes-compat.ts`

**1. ES5 다운레벨 (SWC renderChunk)**

Hermes는 class expressions, private class fields를 지원하지 않음.
SWC `renderChunk`로 `target: 'es5'` 변환하여 class → function, `#private` → 일반 속성으로 변환.

**2. IIFE 래핑 (intro/outro)**

Rolldown `format: 'esm'` 출력에서 top-level `var` 선언이 `globalThis`에 `configurable: false` 속성 생성.
`intro`/`outro`로 IIFE 래핑하여 `var` 선언이 function scope에 머물도록 함.

**3. RN 폴리필 ES5 변환**

RN 폴리필 파일(console.js, error-guard.js)에 ES6+ 구문 포함.
Babel로 Flow 타입 제거 후 SWC `target: 'es5'`로 변환.

#### 해결된 Rolldown 이슈

**1. `(void 0)` 치환** ✅ 근본 해결

- **원인**: flow-strip 플러그인이 CJS Flow 파일을 `moduleType: 'jsx'`(ESM)로 반환 → Rolldown이 named export를 못 찾아 `(void 0)` 치환
- **해결**: flow-strip에서 hermes AST 기반 CJS 감지 (`isCommonJSFromAST`) → CJS 파일은 `moduleType: 'js'`로 반환 → Rolldown이 `__commonJSMin` 래퍼로 올바르게 처리

**2. `__defProp` configurable** ✅ Rolldown 포크에서 해결

- **원인**: Rolldown 런타임의 `__exportAll`, `__copyProps` 등이 `configurable: false`로 export 생성 → RN dev mode 충돌
- **해결**: Rolldown 포크(`ohah/rolldown`)에서 런타임 헬퍼에 `configurable: true` 직접 추가

#### Rolldown upstream 기여 계획

**1. `format: 'iife'`에서 `strictExecutionOrder` 지원** (우선순위: 낮음)

- **문제**: `format: 'iife'`를 사용하면 top-level var 문제가 자연스럽게 해결되지만,
  `strictExecutionOrder`와의 호환성 확인 필요
- **현재**: `format: 'esm'` + `intro`/`outro`로 수동 IIFE 래핑
- **이상적**: `format: 'iife'` + `strictExecutionOrder` 조합이 정상 동작하면
  `intro`/`outro` 해킹 불필요

**2. `__defProp` configurable upstream 기여** (우선순위: 중간)

- Rolldown 포크에서 해결한 `configurable: true` 변경을 upstream PR로 제출 예정
- 포크 의존성을 제거하고 vanilla Rolldown 사용 가능하게 됨

#### Rolldown DevEngine ✅ 전환 완료

Rolldown의 실험적 `dev()` API (DevEngine)로 전환 완료:

- **Patch HMR**: 변경 모듈만 패치 코드 전송 (전체 리빌드 아님)
- **`renderChunk` 지원 확인**: DevEngine이 `renderChunk` 훅을 실행하여 hermes-compat (SWC es5) 적용
- **`devMode.implement`**: runtime.ts를 `transformSync`로 사전 컴파일하여 전달
- **React Refresh**: `import.meta.hot.accept()` 경계로 컴포넌트 상태 보존

**해결된 Rolldown 이슈**:

- `(void 0)` 치환: flow-strip CJS 감지로 근본 해결 (정규식 워크어라운드 제거)
- `__defProp` configurable: Rolldown 포크에서 런타임 헬퍼 수정 (정규식 워크어라운드 제거)

### Phase 5: 고급 기능 (미구현)

#### Metro에 있는 기능

| 기능                | 설명                                                          | 우선순위 | 비고                                               |
| ------------------- | ------------------------------------------------------------- | -------- | -------------------------------------------------- |
| **require.context** | 동적 require 패턴 (`sync`, `eager`, `lazy`, `lazy-once` 모드) | 중간     | Metro 실험적 기능 (`unstable_allowRequireContext`) |
| **RAM Bundle**      | iOS/Android 최적화 번들 형식 (Indexed/File)                   | **낮음** | Hermes가 대체함. 레거시 호환용으로만 필요          |

#### Metro에 없거나 부분적인 기능

| 기능                | 설명                               | Metro 상태                             | Bungae 구현 여부 |
| ------------------- | ---------------------------------- | -------------------------------------- | ---------------- |
| **플러그인 시스템** | 사용자 확장 (커스텀 트랜스포머 등) | Babel 플러그인만 지원                  | 검토 필요        |
| **Code Splitting**  | `import()` 별도 chunk 분리         | 단일 번들만 지원 (lazy loading은 있음) | 검토 필요        |
| **순환 참조 GC**    | Bacon-Rajan 알고리즘               | 없음 (감지만 함)                       | 구현 안 함       |
| **롤백 시스템**     | 빌드 에러 시 이전 상태 복원        | 부분적 (그래프 빌드 중 롤백만)         | 검토 필요        |

#### RAM Bundle 참고사항

RAM Bundle은 **Hermes 이전 시대의 최적화 기법**입니다:

- **2019년 이전**: JSC 엔진 사용 → 전체 번들 파싱 필요 → RAM Bundle로 lazy loading
- **2019년 이후**: Hermes 엔진 기본 → 바이트코드 사전 컴파일 + lazy compilation 내장

React Native 공식 문서에서도 "If you are using Hermes, you should not need to use RAM bundles"라고 명시합니다.
현재 대부분의 RN 앱이 Hermes를 사용하므로 RAM Bundle의 실제 수요는 거의 없습니다.

## Metro 호환성 및 제외된 기능

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

## 참고 자료

- Metro 문서: `reference/metro/docs/`
- Metro 소스: `reference/metro/packages/`
- **Metro 번들 참조**: `metro/` - Metro로 생성된 실제 번들 파일들 (iOS/Android, dev/release)
  - Bungae 번들 결과와 Metro 번들 결과를 비교하기 위한 참조용
  - 비교 대상으로 사용하여 Metro 호환성 검증
- Re.Pack 소스: `reference/repack/` - Webpack/Rspack 기반 React Native 번들러
- Rollipop 소스: `reference/rollipop/` - Rolldown 기반 React Native 번들러
- 상세 가이드: `.claude/skills/bungae-bundler/`

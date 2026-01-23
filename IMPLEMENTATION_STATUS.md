# Bungae 구현 현황 및 Metro 호환성 분석

## 📊 현재 Phase 상태

### ✅ Phase 1: 핵심 번들링 (완료)

#### 1. Config 시스템 (Phase 1-1) ✅

- [x] Config 파일 로딩 (`bungae.config.ts/js/json`, `package.json`)
- [x] Config 병합 및 기본값 처리
- [x] Config 검증 로직 (타입 및 값 검증)
- [x] Server config 추가 (port, useGlobalHotkey, forwardClientLogs 등)
- [x] Metro-compatible API (`loadConfig({ config, cwd })`)
- [x] Metro 스타일 테스트 코드 (11개 테스트 케이스 모두 통과)

#### 2. Platform Resolver Plugin (Phase 1-2) ✅

- [x] Bun Plugin으로 플랫폼 확장자 처리
- [x] `.ios.js`, `.android.js`, `.native.js` 지원
- [x] TypeScript 확장자 지원 (`.ios.tsx`, `.android.ts` 등)
- [x] `preferNativePlatform` 옵션 지원
- [x] 테스트 코드 작성 완료 (5개 테스트 케이스 모두 통과)

#### 3. 코드 변환 (Transformation) (Phase 1-3 → Phase 1+) ✅

- [x] Babel + Hermes Parser 기반 변환 (Metro 동일)
- [x] @react-native/babel-preset 사용 (Metro와 동일한 변환)
- [x] TypeScript/TSX/JSX/Flow → JavaScript 변환
- [x] 의존성 추출 (require, import, dynamic import)
- [x] Metro 스타일 테스트 코드 통과
- [x] babel.config.js 로딩 및 병합 지원

#### 4. Serialization (Phase 1-3) ✅

- [x] baseJSBundle 구현 (Metro 호환)
- [x] metro-runtime 번들 포함
- [x] prelude, polyfills 지원
- [x] `__d()`, `__r()` 형식 지원
- [x] 모듈 ID 생성 및 정렬
- [x] Source map URL 지원 (주석으로 추가)
- [x] Metro 스타일 테스트 코드 (15개 테스트 케이스 모두 통과)

### ✅ Phase 2: 개발 환경 (완료)

#### 1. 증분 빌드 시스템 (Phase 2-1) ✅

- [x] `incrementalBuild()` 함수 구현
- [x] 파일 변경 시 영향받은 모듈만 재빌드
- [x] 이전 그래프와 새 그래프 간 델타 계산 (`calculateDelta()`)
- [x] 역의존성 그래프를 통한 영향받은 모듈 추적 (`getAffectedModules()`)
- [x] 모듈 ID 일관성 유지 (동일한 `createModuleId` 팩토리 재사용)
- [x] 플랫폼별 빌드 상태 관리 (다중 플랫폼 HMR 지원)

#### 2. 개발 서버 (Phase 2-2) ✅

- [x] `serveWithGraph()` 함수 구현
- [x] Bun.serve() 기반 HTTP 서버
- [x] 번들 요청 처리 (`/index.bundle?platform=ios&dev=true`)
- [x] WebSocket 지원 (HMR용)
- [x] 플랫폼별 번들 캐싱
- [x] Multipart/mixed 응답 지원 (Metro 호환)
- [x] Asset 서빙 (HTTP를 통한 이미지 등)
- [x] `/status` 엔드포인트
- [x] `/open-url` 엔드포인트 (Metro 호환)

#### 6. 터미널 단축키 (Phase 2-5) ❌

- [ ] Metro 호환 터미널 단축키 지원
- [ ] `r` - Reload (앱 리로드)
- [ ] `d` - Open Dev Menu (개발 메뉴 열기)
- [ ] `i` - Open iOS Simulator
- [ ] `a` - Open Android Emulator
- [ ] `j` - Open Chrome DevTools
- [ ] `c` - Clear cache
- [ ] `useGlobalHotkey` 설정 옵션 지원 (기본값: true)

#### 3. HMR (Hot Module Replacement) (Phase 2-3) ✅

- [x] **Metro 호환 HMR 프로토콜**: React Native의 내장 HMRClient와 호환
- [x] Metro HMR 메시지 형식 구현:
  - `update-start` / `update-done`: 업데이트 생명주기
  - `update`: 추가/수정/삭제된 모듈 정보
  - `error`: 빌드 실패 시 에러 전송
- [x] `createHMRUpdateMessage()`: Metro 호환 HMR 업데이트 메시지 생성
- [x] 모듈 ID 일관성: 빌드 간 동일한 `createModuleId` 팩토리 재사용
- [x] 역의존성 그래프: React Refresh 경계를 위한 Metro의 상향 순회 패턴 지원
- [x] 다중 플랫폼 HMR: iOS/Android 각각 독립적인 HMR 업데이트
- [x] 테스트 코드 작성 완료 (15개 이상의 테스트 케이스 모두 통과)

#### 4. 파일 감시 (Phase 2-4) ✅

- [x] `file-watcher.ts` 모듈 구현
- [x] 파일 변경 감지 및 HMR 트리거
- [x] 원자적 쓰기 처리 (VSCode 등 에디터의 rename 이벤트)
- [x] JS/TS/JSON 소스 파일만 처리하도록 필터링
- [x] 디바운싱 지원 (기본 300ms)

---

## 🚧 Phase 3: 최적화 (부분 구현)

### 1. Source Map 생성 ✅

- [x] 실제 Source Map 생성 (source-map 라이브러리 사용)
- [x] Source Map URL 주석 추가
- [x] Source Map 파일 생성 (`.map` 파일)

### 2. Source Map 고급 기능 (부분 구현)

- [x] `inlineSourceMap` 옵션 (base64 인코딩된 source map을 번들에 인라인 포함)
- [ ] `x_google_ignoreList` 생성 (Chrome DevTools에서 특정 파일 제외)

### 3. Minification ❌

- [ ] Production 빌드 시 코드 압축
- [ ] Terser 또는 Bun 내장 minifier 사용

### 4. Tree Shaking ❌

- [ ] 사용하지 않는 코드 제거
- [ ] Dead code elimination

### 5. 영구 캐싱 ❌

- [ ] 디스크 기반 변환 캐시
- [ ] 캐시 무효화 전략

---

## 🔮 Phase 4: 고급 기능 (미구현)

### 1. RAM Bundle ❌

- [ ] RAM Indexed Bundle (iOS 최적화)
- [ ] RAM File Bundle (Android 최적화)

### 2. Fast Refresh (React Refresh) ✅

- [x] React Refresh 지원 (검증 완료)
- [x] 컴포넌트 상태 유지
- [x] `setUpReactRefresh` 모듈 포함
- [x] `setUpDeveloperTools` 모듈 포함
- [x] `react-refresh/runtime` 포함

### 3. 플러그인 시스템 ❌

- [ ] Metro 플러그인 호환성
- [ ] 커스텀 transformer 플러그인
- [ ] 커스텀 serializer 플러그인

### 4. require.context ❌

- [ ] 동적 require 지원
- [ ] require.context() API

### 5. Lazy/Async 모듈 ❌

- [ ] Dynamic import 지원
- [ ] Code splitting
- [ ] Lazy loading

---

## 📋 Metro 호환성 분석

### ✅ 완전 호환 가능한 기능

다음 기능들은 Metro와 **100% 호환** 가능합니다:

1. **Config 시스템**
   - ✅ Config 파일 로딩 및 병합
   - ✅ Metro-compatible API (`loadConfig({ config, cwd })`)
   - ✅ Function/Promise export 지원

2. **모듈 해석 (Resolution)**
   - ✅ Platform 확장자 처리 (`.ios.js`, `.android.js`, `.native.js`)
   - ✅ TypeScript 확장자 지원
   - ✅ `node_modules` 해석
   - ✅ Monorepo 지원 (`nodeModulesPaths`)

3. **코드 변환 (Transformation)**
   - ✅ Babel + Hermes Parser (Metro와 동일)
   - ✅ @react-native/babel-preset 사용
   - ✅ Flow 구문 파싱
   - ✅ JSX/TSX 변환
   - ✅ ESM → CJS 변환
   - ✅ babel.config.js 로딩

4. **번들 직렬화 (Serialization)**
   - ✅ baseJSBundle 형식 (Metro 호환)
   - ✅ `__d()`, `__r()` 형식
   - ✅ metro-runtime 포함
   - ✅ prelude, polyfills 지원
   - ✅ 모듈 ID 생성 및 정렬

5. **개발 서버**
   - ✅ HTTP 서버 (Bun.serve)
   - ✅ 번들 요청 처리 (`/index.bundle?platform=ios&dev=true`)
   - ✅ Multipart/mixed 응답 (Metro 호환)
   - ✅ Asset 서빙
   - ✅ `/status` 엔드포인트
   - ✅ `/open-url` 엔드포인트
   - ✅ `/symbolicate` 엔드포인트 (React Native LogBox 호환)
     - ✅ 스택 트레이스 symbolication 지원
     - ✅ 소스맵 기반 원본 파일 경로/라인 번호 변환
     - ✅ Code frame 생성 (에러 위치 표시)
     - ✅ Metro 호환 프로토콜 및 응답 형식

6. **HMR (Hot Module Replacement)**
   - ✅ Metro HMR 프로토콜 (React Native HMRClient 호환)
   - ✅ `update-start`, `update`, `update-done` 메시지
   - ✅ 역의존성 그래프 지원
   - ✅ 다중 플랫폼 HMR

7. **React Refresh (Fast Refresh)**
   - ✅ `setUpReactRefresh` 모듈 포함 (검증 완료)
   - ✅ `setUpDeveloperTools` 모듈 포함
   - ✅ `react-refresh/runtime` 포함
   - ✅ `__ReactRefresh` 전역 변수 설정
   - ✅ 컴포넌트 상태 유지 지원
   - 📝 자세한 검증 결과: `REACT_REFRESH_VERIFICATION.md` 참고

8. **증분 빌드**
   - ✅ 파일 변경 감지
   - ✅ 영향받은 모듈만 재빌드
   - ✅ 델타 계산

### ⚠️ 부분 호환 또는 제한적 호환

다음 기능들은 **부분적으로만 호환**되거나 **제한적**입니다:

1. **Source Map**
   - ✅ Source Map 생성 및 파일 생성 지원
   - ✅ `inlineSourceMap` 옵션 지원
   - ✅ `/symbolicate` 엔드포인트를 통한 스택 트레이스 symbolication 지원
   - ✅ React Native LogBox와의 완전 호환
   - ❌ `x_google_ignoreList` 생성 미지원

2. **Production 빌드**
   - ⚠️ 기본 번들링은 가능하지만 최적화 기능 부족
   - ❌ Minification 미지원
   - ❌ Tree Shaking 미지원

3. **고급 번들 타입**
   - ❌ RAM Bundle (Indexed/File) 미지원
   - ✅ Plain Bundle만 지원
   - ✅ `setUpReactRefresh` 모듈 포함
   - ✅ `setUpDeveloperTools` 모듈 포함
   - ✅ `react-refresh/runtime` 포함
   - ✅ `__ReactRefresh` 전역 변수 설정
   - ✅ 컴포넌트 상태 유지 지원
   - 📝 자세한 검증 결과: `REACT_REFRESH_VERIFICATION.md` 참고

### ❌ 미지원 기능 (의도적으로 제외)

다음 기능들은 Metro에 있지만 Bungae에서는 **의도적으로 구현하지 않습니다**:

1. **cacheStores (callback 패턴)**
   - **제외 이유**: Bun은 자체 캐시 시스템을 제공하거나 다른 방식으로 캐시를 관리할 수 있음
   - **대안**: 향후 Bun의 내장 캐시 시스템 활용 예정

2. **YAML config 지원**
   - **제외 이유**: Metro에서도 deprecated 상태이며, 레거시 지원이 필요 없음
   - **대안**: JavaScript/TypeScript config만 지원

---

## 🎯 Metro와 완전 동일한 옵션으로 100% 호환 가능한가?

### ✅ **기본 번들링: 100% 호환 가능**

다음 시나리오에서는 Metro와 **완전히 동일하게** 사용 가능합니다:

1. **개발 모드 번들링**
   - ✅ Entry 파일부터 모든 의존성 해석
   - ✅ Platform 확장자 처리
   - ✅ Babel 변환 (Metro와 동일)
   - ✅ 번들 직렬화 (Metro 호환 형식)
   - ✅ 개발 서버 및 HMR

2. **기본 Production 빌드**
   - ✅ Entry 파일부터 모든 의존성 해석
   - ✅ Platform 확장자 처리
   - ✅ Babel 변환 (Metro와 동일)
   - ✅ 번들 직렬화 (Metro 호환 형식)
   - ⚠️ Minification 없음 (코드 크기 증가)

### ⚠️ **제한 사항**

다음 기능들이 필요하면 **추가 구현이 필요**합니다:

1. **Source Map 디버깅**
   - ❌ 실제 source map 파일 생성 미구현
   - ⚠️ Source Map URL 주석만 있음 (디버깅 제한적)

2. **Production 최적화**
   - ❌ Minification 없음 (번들 크기 증가)
   - ❌ Tree Shaking 없음 (사용하지 않는 코드 포함)

3. **고급 번들 타입**
   - ❌ RAM Bundle 미지원 (iOS/Android 최적화 제한)

---

## 📝 결론

### 현재 상태: **Phase 2 완료**

- ✅ **Phase 1**: 핵심 번들링 완료
- ✅ **Phase 2**: 개발 환경 완료
- ❌ **Phase 3**: 최적화 미구현
- ❌ **Phase 4**: 고급 기능 미구현

### Metro 호환성: **기본 기능 100% 호환, 고급 기능 제한적**

**✅ 완전 호환 가능:**

- 개발 모드 번들링 및 HMR
- React Refresh (Fast Refresh) - 컴포넌트 상태 유지
- 기본 Production 빌드 (최적화 제외)
- 모듈 해석 및 변환
- 개발 서버

**⚠️ 부분 호환 또는 미지원:**

- Source Map 고급 기능 (`x_google_ignoreList` 미지원)
- Production 최적화 (Minification, Tree Shaking)
- RAM Bundle

**❌ 의도적으로 제외:**

- cacheStores (callback 패턴)
- YAML config 지원

### 권장 사용 시나리오

1. **✅ 권장**: 개발 모드 번들링 및 HMR
2. **✅ 권장**: 기본 Production 빌드 (최적화 불필요한 경우)
3. **✅ 권장**: Source Map 디버깅 (dev 모드에서 자동 생성)
4. **⚠️ 제한적**: Production 최적화가 필요한 경우
5. **❌ 미지원**: RAM Bundle이 필요한 경우

---

## 🔄 다음 단계 (우선순위)

### Phase 3-1: Source Map 생성 (높은 우선순위) ✅

- [x] 실제 Source Map 생성 로직 구현
- [x] `inlineSourceMap` 옵션 지원
- [ ] `x_google_ignoreList` 생성 (낮은 우선순위)

### Phase 3-2: Production 최적화 (중간 우선순위)

- [ ] Minification 구현
- [ ] Tree Shaking 구현
- [ ] 영구 캐싱 구현

### Phase 4-1: RAM Bundle (낮은 우선순위)

- [ ] RAM Indexed Bundle 구현
- [ ] RAM File Bundle 구현

### Phase 4-2: React Refresh ✅ (완료)

- [x] React Refresh 지원 (검증 완료)
- [x] 컴포넌트 상태 유지

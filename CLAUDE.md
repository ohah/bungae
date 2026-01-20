# Bungae - Metro 호환 React Native 번들러

Bun 기반 React Native 번들러로, Metro와 호환되면서 더 나은 성능을 제공합니다.

## 핵심 원칙

1. **Metro 호환성 우선**: 기존 Metro 프로젝트가 최소한의 변경으로 마이그레이션 가능
2. **성능 최우선**: Bun의 성능 이점을 최대한 활용하여 빌드 속도 개선
3. **점진적 개선**: 핵심 기능부터 구현하고 점진적으로 확장
4. **Bun 네이티브 우선**: 가능한 한 Bun 내장 API 활용

## 번들링 프로세스

3단계 파이프라인: `Entry → [Resolution] → [Transformation] → [Serialization] → Bundle`

### Resolution (모듈 해석)

- **자체 모듈 해석**: `require.resolve()` 기반 모듈 해석
- **Platform Resolver**: React Native 플랫폼 확장자 (`.ios.js`, `.android.js`, `.native.js`) 처리
- **구현 위치**: `graph-bundler.ts`의 `resolveModule()` 함수

### Transformation (코드 변환)

**현재 구현 (Phase 1+)**: Metro와 동일하게 **Babel + Hermes Parser** 사용

```
Entry → Hermes Parser (Flow 파싱) → @react-native/babel-preset (모든 변환) → Output
```

| 도구                       | 역할                                           |
| -------------------------- | ---------------------------------------------- |
| Hermes Parser              | Flow 구문 파싱 (Metro와 동일)                  |
| @react-native/babel-preset | Flow 제거, JSX 변환, ESM→CJS 변환 (all-in-one) |

**구현 위치**: `graph-bundler.ts`의 `transformWithBabel()` 함수

#### 미사용 코드 (주석 처리됨)

다음 파일들은 현재 사용하지 않으며, 향후 최적화를 위해 보관:

- `bun-transformer.ts` - Bun.Transpiler 사용 (Flow 미지원)
- `swc-transformer.ts` - SWC 사용 (Flow 미지원)
- `bun-bundler.ts` - Bun.build() 사용 (Metro 모듈 시스템 미지원)

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
- RAM Bundle (Indexed/File) - iOS/Android 최적화

## Bun API 활용

```typescript
// ✅ 현재 사용 중
Bun.serve(); // HTTP 서버 + WebSocket (HMR)
Bun.file(); // 파일 I/O

// 🔄 향후 사용 예정 (점진적 전환)
Bun.Transpiler; // 코드 변환 (현재는 Babel 사용)
Bun.build(); // 번들링 (현재는 자체 그래프 빌더 사용)
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

#### 🔄 진행 중

- Phase 2: 개발 환경 (증분 빌드, 개발 서버, HMR)

### Phase 2: 개발 환경

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
    added: [[moduleId, code, sourceURL], ...],
    modified: [[moduleId, code, sourceURL], ...],
    deleted: [moduleId, ...]
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

#### 📋 Phase 1-3에서 구현하지 않은 기능 (Phase 2 또는 Phase 3에서 구현 예정)

다음 기능들은 Metro에 있지만 Phase 1-3에서는 구현하지 않았으며, Phase 2 또는 Phase 3에서 구현할 예정입니다:

1. **inlineSourceMap 옵션**
   - **Metro에서의 용도**: Source map을 번들 파일에 인라인으로 포함 (base64 인코딩)
   - **구현 시점**: Phase 2 또는 Phase 3
   - **관련 테스트**: `should add an inline source map to a very simple bundle` (Metro 테스트)

2. **x_google_ignoreList 생성**
   - **Metro에서의 용도**: Chrome DevTools에서 특정 소스 파일을 디버깅에서 제외하기 위한 source map 메타데이터
   - **구현 시점**: Phase 2 또는 Phase 3
   - **관련 테스트**: `emits x_google_ignoreList based on shouldAddToIgnoreList` (Metro 테스트)
   - **참고**: `shouldAddToIgnoreList` 옵션은 이미 있지만, `x_google_ignoreList` 생성 로직은 미구현

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

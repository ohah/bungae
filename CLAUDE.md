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

- **Bun.build() 기본 해석 활용**: Node.js 표준 모듈 해석, Package Exports 지원
- **Platform Resolver Plugin**: React Native 플랫폼 확장자 (`.ios.js`, `.android.js`, `.native.js`) 처리
- **구현 전략**: Bun의 내장 해석을 활용하고, 플랫폼 확장자만 Plugin으로 추가

### Transformation (코드 변환)

- **기본**: Bun 내장 트랜스파일러 사용 (가장 빠름)
- **선택적**: Babel 통합 (react-native-reanimated 등 필요한 경우만)
- TypeScript/TSX, JSX 변환
- ES Modules → CommonJS

### Serialization (번들 직렬화)

- Plain Bundle (기본)
- RAM Bundle (Indexed/File) - iOS/Android 최적화

## Bun API 활용

```typescript
// ✅ Good: Bun 네이티브 API 사용
Bun.file(); // 파일 I/O
Bun.serve(); // HTTP 서버
Bun.Transpiler; // 코드 변환
Bun.worker(); // 병렬 처리
Bun.hash(); // 캐시 키 생성

// ❌ Avoid: 불필요한 Babel 사용
// Bun 내장 트랜스파일러로 충분한 경우 Babel 사용 지양
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

3. **코드 변환 (Transformation)** (Phase 1-3)
   - Bun.Transpiler 기반 변환 구현
   - TypeScript/TSX/JSX → JavaScript 변환
   - 의존성 추출 (require, import, dynamic import)
   - Babel 선택적 통합 스켈레톤 (Phase 2에서 구현)
   - Metro 스타일 테스트 코드 (10개 테스트 케이스 모두 통과)

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

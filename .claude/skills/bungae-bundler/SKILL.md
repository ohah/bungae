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

| Category     | File                    | Description                            |
| ------------ | ----------------------- | -------------------------------------- |
| Overview     | `rules/overview.md`     | 프로젝트 구조 및 로드맵                |
| Bundling     | `rules/bundling.md`     | 3단계 번들링 프로세스                  |
| Resolution   | `rules/resolution.md`   | 모듈 해석 전략 (Bun.build + Plugin)    |
| Config       | `rules/config.md`       | 설정 시스템 스키마                     |
| Transformer  | `rules/transformer.md`  | 코드 변환 및 Babel 통합                |
| Dev Server   | `rules/dev-server.md`   | 개발 서버 및 HMR                       |
| Optimization | `rules/optimization.md` | 캐싱 및 성능 최적화                    |
| Bun APIs     | `rules/bun-apis.md`     | Bun API 활용 가이드                    |
| Bunup        | `rules/bunup.md`        | Bunup 빌드 도구 가이드                 |
| Testing      | `rules/testing.md`      | 테스트 코드 작성 가이드 (Metro 스타일) |

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

### Transformer 전략

```typescript
transformer: {
  // 기본: Bun 트랜스파일러 (가장 빠름)
  default: 'bun',

  // Babel 필요한 패키지만 지정
  babel: {
    include: ['**/react-native-reanimated/**'],
    plugins: ['react-native-reanimated/plugin'],
  },
}
```

### Babel이 필요한 케이스

| 라이브러리              | 이유             |
| ----------------------- | ---------------- |
| react-native-reanimated | worklet 변환     |
| styled-components       | displayName 주입 |
| decorator 문법          | @observable 등   |
| Flow 코드               | 타입 제거        |

### 주요 Bun API

```typescript
Bun.file(); // 파일 I/O
Bun.serve(); // HTTP 서버
Bun.build(); // 번들링
Bun.Transpiler; // 코드 변환
```

## Implementation Roadmap

### Phase 1: 핵심 번들링

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
- [ ] 코드 변환 (Transformation) - Bun.Transpiler 기본 + 선택적 Babel
- [ ] Serialization - Metro 호환 번들 형식

**⚠️ Resolution 구현 전략**:

- Bun.build()의 기본 해석을 활용
- 플랫폼 확장자만 Plugin으로 추가 처리
- 완전히 새로 구현할 필요 없음

### Phase 2: 개발 환경

- [ ] 개발 서버
- [ ] 파일 감시
- [ ] HMR

### Phase 3: 최적화

- [ ] 캐싱
- [ ] 증분 빌드
- [ ] Minification

### Phase 4: 고급 기능

- [ ] RAM Bundle
- [ ] Fast Refresh
- [ ] 플러그인 시스템

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

**참고**: Metro 코드에서 YAML 지원은 다음과 같이 deprecated 처리되어 있습니다:

```javascript
console.warn(
  'YAML config is deprecated, please migrate to JavaScript config (e.g. metro.config.js)',
);
```

## Reference

- Metro: `reference/metro/packages/`
- Rollipop: `reference/rollipop/packages/rollipop/`

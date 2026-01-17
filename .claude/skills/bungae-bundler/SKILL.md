---
name: bungae-bundler
description: Bungae React Native 번들러 개발 가이드. 번들링 구현, 설정 시스템, 개발 서버, Babel 통합 등 번들러 개발 작업 시 참조. Resolution, Transformation, Serialization 파이프라인 구현 및 Metro 호환성 유지에 활용.
license: MIT
metadata:
  author: ohah
  version: "0.0.1"
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

| Category | File | Description |
|----------|------|-------------|
| Overview | `rules/overview.md` | 프로젝트 구조 및 로드맵 |
| Bundling | `rules/bundling.md` | 3단계 번들링 프로세스 |
| Config | `rules/config.md` | 설정 시스템 스키마 |
| Transformer | `rules/transformer.md` | 코드 변환 및 Babel 통합 |
| Dev Server | `rules/dev-server.md` | 개발 서버 및 HMR |
| Optimization | `rules/optimization.md` | 캐싱 및 성능 최적화 |
| Bun APIs | `rules/bun-apis.md` | Bun API 활용 가이드 |

## Quick Reference

### 기술 스택

| 항목 | 선택 | 이유 |
|------|------|------|
| 런타임 | Bun | 빠른 JS 런타임, 내장 트랜스파일러 |
| 빌드 | Bunup | Bun 네이티브 라이브러리 빌드 |
| Lint/Format | oxlint, oxfmt | 빠른 린팅/포매팅 |

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

| 라이브러리 | 이유 |
|-----------|------|
| react-native-reanimated | worklet 변환 |
| styled-components | displayName 주입 |
| decorator 문법 | @observable 등 |
| Flow 코드 | 타입 제거 |

### 주요 Bun API

```typescript
Bun.file()      // 파일 I/O
Bun.serve()     // HTTP 서버
Bun.build()     // 번들링
Bun.Transpiler  // 코드 변환
```

## Implementation Roadmap

### Phase 1: 핵심 번들링
- [ ] 모듈 해석 (Resolution)
- [ ] 코드 변환 (Transformation)
- [ ] Plain Bundle 출력

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

## Reference

- Metro: `reference/metro/packages/`
- Rollipop: `reference/rollipop/packages/rollipop/`

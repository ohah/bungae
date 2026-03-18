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

## Reference

- Metro: `reference/metro/packages/`
- Rollipop: `reference/rollipop/packages/rollipop/`

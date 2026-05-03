---
title: 소개
description: Bungae가 무엇인지, 어떤 문제를 해결하는지
---

**Bungae**는 Metro 호환 React Native 번들러입니다. Zig로 작성된 [ZTS](https://github.com/ohah/zts) 트랜스파일러를 NAPI로 in-process 호출하고, [Bun](https://bun.sh) 런타임 위에서 동작합니다.

## 한 문장으로

> **Metro 호환 인터페이스 + Zig 코어 = 5x 빠른 빌드**, 마이그레이션 비용 0.

## 무엇이 다른가

Metro의 가장 큰 강점은 React Native 생태계와의 완벽한 통합입니다. Bundle 형식, HMR 프로토콜, 플러그인 인터페이스, Babel transformer 체인 — 이 모든 것이 RN 라이브러리가 기대하는 형태입니다. Bungae는 이걸 **그대로 유지**합니다.

대신 무거운 부분만 갈아끼웠습니다:

| 단계           | Metro                        | Bungae                            |
| -------------- | ---------------------------- | --------------------------------- |
| Transformer    | Babel (worker pool)          | **ZTS (Zig, in-process NAPI)**    |
| Bundler        | Metro (Node.js)              | **ZTS (Zig)**                     |
| HTTP/WS Server | metro-server (Connect)       | **Bun.serve()**                   |
| File I/O       | Node fs                      | **Bun.file()**                    |
| HMR Protocol   | Metro 표준                   | **Metro 표준 (그대로)**           |
| HMR Client     | RN 내장 HMRClient.js         | **RN 내장 HMRClient.js (그대로)** |
| Dev middleware | @react-native/dev-middleware | **그대로**                        |

ZTS는 Babel 없이 TypeScript / JSX / Flow / Reanimated worklet까지 모두 Zig로 처리합니다. 코드 한 줄을 변환하는 데 필요한 가장 빠른 경로 — 파서·타입 스트리퍼·코드 생성기 — 를 통째로 네이티브화한 게 핵심입니다.

## 어떤 프로젝트에 어울리나

- ✅ **Metro로 빌드 중인 RN 앱** — 마이그레이션 거의 없음
- ✅ **Expo 프로젝트** — `withExpo()` 한 줄로 winter polyfill, metro-runtime, expo-image/sqlite assetExts 자동 적용
- ✅ **모노레포** — workspace hoisting을 false-positive 없이 처리
- ✅ **개발 속도가 critical한 팀** — HMR 사이클이 짧아짐, 신규 빌드 5x

## 설계 원칙

1. **Metro 호환 우선** — 마이그레이션 비용은 0이어야 함
2. **점진적 네이티브 전환** — Babel이 들어간 곳도 단계적으로 ZTS로 교체
3. **Bun 네이티브 우선** — 런타임 측 모든 I/O / HTTP / 파일 처리는 Bun API 활용
4. **명시적 통합** — Expo 등의 통합은 `withExpo()` 같은 명시 wrapper로. monorepo-safe.

## 다음 단계

- [왜 빠른가](/bungae/guides/why-fast/) — 5x의 근거를 정량으로 분해
- [설치](/bungae/guides/installation/) — 5분 안에 시작
- [아키텍처 개요](/bungae/guides/architecture/) — 파이프라인 한눈에

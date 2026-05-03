---
title: 왜 빠른가
description: Bungae가 Metro 대비 5x 빠른 정량적 근거와 메커니즘
---

## 실측 데이터

ExampleApp(RN 0.85, 1595 files, iOS, production minified) 기준:

| 번들러           | 모드                | 빌드 시간   | 번들 크기 |
| ---------------- | ------------------- | ----------- | --------- |
| **Bungae (ZTS)** | dev                 | **2329 ms** | 8235 KB   |
| **Bungae (ZTS)** | production minified | **2215 ms** | 3580 KB   |
| Metro            | development         | 12506 ms    | 8437 KB   |
| Metro            | production minified | 11547 ms    | 2076 KB   |

→ **빌드 시간 5.2× 단축** (production 기준).

## 빠른 이유 4가지

### 1. Zig 네이티브 트랜스파일러 (ZTS)

Babel은 일반 목적 변환기라 hot path가 무겁습니다. 모든 변환이 JS 객체 트리 위에서 동작하고, 매 파일마다 plugin chain을 visitor pattern으로 traverse합니다. JIT 워밍이 끝난 뒤에도 GC 압력과 함수 호출 비용이 누적됩니다.

**ZTS는 Zig로 작성된 단일 패스 트랜스파일러**입니다:

- 자체 lexer + parser (`packages/zts/packages/core/src/`)
- AST 객체 할당 없음 — arena 기반 직접 처리
- TypeScript 타입 어노테이션 / JSX / Flow 모두 한 번의 walk로 처리
- 출력은 직접 byte buffer로 emit

Babel이 같은 파일을 처리할 때의 비용 (parse → traverse N개 plugin → print)을 한 단계로 압축한 것이 가장 큰 이득입니다.

### 2. NAPI in-process 호출 (subprocess 아님)

ZTS는 `.node` native addon으로 Bun에 로딩됩니다. 즉 매 파일 변환에서 **subprocess fork도, IPC pipe도 없습니다**. JS에서 함수 호출하듯이 Zig 함수를 호출합니다.

비교:

- esbuild: Go 바이너리에 stdin/stdout 통신 → 작은 IPC 비용
- swc: NAPI in-process (ZTS와 동일 구조)
- Babel: 순수 JS, NAPI 없음
- Metro: Babel 위에 worker pool — worker process spawn + IPC

NAPI hop의 한 번 오버헤드는 약 0.05~0.3ms 수준이라 파일 수가 많아도 누적 영향이 작습니다.

### 3. Bun 런타임

Dev server는 Bun이 제공하는 API를 직접 사용:

- **Bun.serve()** — HTTP + WebSocket 통합. Connect/express 미들웨어보다 빠름. Metro의 metro-server는 Node http + ws 별도 layer
- **Bun.file()** — Lazy-loaded, system call 한 번에 read. Node fs보다 zero-copy 경로 많음
- **Bun 자체** — JS 실행 자체가 Node보다 빠름 (cold start, JSC 엔진)

`bungae start` 실행 시 dev server가 떠 있는 데 걸리는 시간이 ms 단위인 이유.

### 4. 변환 캐시 + on-demand 멀티플랫폼

- iOS / Android 동시 dev server. 첫 요청 시 ZTS 프로세스가 lazily spawn
- 변환 결과는 `.bungae-cache/` 에 디스크 캐시 (PersistentCache). 재빌드 / HMR 시 거의 0
- 파일 변경 시 영향받은 모듈만 재변환 (incremental build)

## 진짜 critical path는 무엇인가

직접 측정해보면 빌드 시간 분포는 대략 이렇습니다:

| 단계                                                               | 비중 |
| ------------------------------------------------------------------ | ---- |
| ZTS native transform (1595 files)                                  | ~70% |
| 의존성 그래프 빌드 + serialize                                     | ~20% |
| `@react-native/babel-plugin-codegen` (NativeComponent view config) | ~10% |
| 그 외 (NAPI hop, plugin orchestration)                             | <1%  |

ZTS 자체가 critical path. 즉 ZTS가 빨라질수록 Bungae가 빨라집니다. ZTS는 활발히 최적화 중 (#1589 codegen native, mini-type-stripper 등).

## Metro와 정확한 비교점

Bungae가 "5x 빠르다"는 건 동일 입력·동일 출력 형태일 때의 결과입니다:

- ✅ 동일: bundle 형식 (`__d(N)/__r(N)`), HMR 프로토콜, plugin 인터페이스, `runBeforeMainModule` 순서
- ✅ 동일: source map, x_google_ignoreList, inlineSourceMap, asset registry
- ⚠️ 비호환: 일부 Metro hook (`transformer.getTransformOptions`, custom serializer 등) — 자세한 호환 매트릭스는 [CLAUDE.md의 ZTS Metro Config Hook 매트릭스](https://github.com/ohah/bungae/blob/main/CLAUDE.md) 참고

## 5x 가 모든 환경에 적용되는가

- 네이티브 RN 패키지(react-native-screens, reanimated 등) 처리 비중이 큰 프로젝트는 차이가 더 큽니다 (Babel preset 비용이 사라짐)
- 작은 앱(파일 수 < 500)은 절대 시간 차이가 작아 체감 비율이 줄어듭니다
- HMR 한 회 사이클은 ms 수준이라 경험상 가장 큰 차이가 느껴지는 부분

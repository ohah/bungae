# Bungae → ZTS 번들링 엔진 전환 계획

> 2026-03-27 의사결정 완료. Bungae의 번들링 엔진을 Rolldown에서 ZTS로 전환하는 계획.

## 배경

Bungae는 현재 3개 번들러를 지원:
- `graph` (Babel 기반, Metro 호환, 기본값)
- `bun` (Bun.Transpiler 기반, 보류)
- `oxc` (Rolldown 기반, 개발 환경 완료)

ZTS는 Zig로 작성한 풀 파이프라인 JS/TS 트랜스파일러 + 번들러로, 렉서부터 dev server까지 모두 구현 완료 (Test262 50,504건 100% 통과). 새로운 번들러 옵션 `zts`로 추가한다.

## 확정 사항

### 1. 프로젝트 구조: 분리 유지

```
ZTS (범용 번들러)              Bungae (RN 전용 래퍼)
├── 파싱, 변환, 번들링          ├── bungae.config.ts 로딩
├── 소스맵, minify              ├── HTTP 서버 (Bun.serve)
├── Flow 스트리핑               ├── @react-native/dev-middleware
├── ES5 다운레벨                ├── @react-native-community/cli-server-api
├── tree-shaking                ├── Babel 폴백 실행
├── code splitting              ├── 터미널 단축키 (r, d, i, a)
├── 증분 빌드                   └── Hermes 바이트코드 (hermesc 호출)
├── HMR 패치 생성
└── 파일 감시
```

- **ZTS** = esbuild/Rolldown처럼 범용 번들러로 포지셔닝. 웹에서도 독립적으로 사용 가능.
- **Bungae** = ZTS 위의 RN 특화 도구. config 전달 + 서버 + RN 생태계 접착.
- 이유: ZTS를 RN 전용으로 묶으면 웹 사용자층을 잃음.

### 2. 통신 방식: NAPI

```
Bun 프로세스
├── HTTP 서버, dev-middleware, config
└── ZTS NAPI addon (.node)
    ├── bundle(entry, options) → 번들 결과
    ├── incrementalUpdate(changedFiles) → 패치
    └── 모듈 그래프를 메모리에 유지 (증분 빌드)
```

- Zig로 빌드한 `.node` addon을 Bun에서 직접 호출.
- 메모리 공유로 직렬화 오버헤드 없음.
- esbuild/SWC/oxc가 검증한 패턴.
- ZTS는 자체 코드라 크래시 리스크 관리 가능 (Rolldown NAPI 크래시와 다른 상황).

**다른 방식을 선택하지 않은 이유:**
- Subprocess: 프로세스 종료 시 모듈 그래프 소멸 → 증분 빌드 불가.
- 장기 프로세스 + IPC: 번들 결과(수 MB) 직렬화/역직렬화 오버헤드. NAPI는 포인터 공유로 복사 없음.

### 3. 모듈 시스템: ESM Scope Hoisting

- `__d`/`__r` Metro 런타임 래핑 불필요.
- ZTS의 scope hoisting + linker가 ESM으로 번들링.
- Rolldown(oxc-bundler)과 동일한 접근.

### 4. HMR: ZTS 자체 프로토콜

- Metro HMR 프로토콜(`update-start`, `update`, `update-done`) 불사용.
- ZTS dev server의 자체 WebSocket 프로토콜 + 패치 시스템.
- HMR 클라이언트는 순수 JavaScript로 번들에 주입 (네이티브 모듈 설치 불필요).

### 5. DevTools 호환

DevTools는 Metro 모듈 시스템이 아니라 HTTP 엔드포인트 + 소스맵에 의존:

| 기능 | 담당 | 구현 |
|------|------|------|
| Source Map 서빙 | Bungae (서버) | `GET /index.bundle.map` |
| `/symbolicate` | Bungae (서버) | 스택 트레이스 → 원본 소스 매핑 |
| CDP 프록시 | Bungae (서버) | `@react-native/dev-middleware` |
| React DevTools | 앱 내 JS | `react-devtools-core` (번들러 무관) |

### 6. Flow: ZTS에서 직접 구현

- RN 코어 라이브러리가 Flow로 작성되어 있으므로 필수.
- RN 폴리필(InitializeCore.js, console.js 등) 변환도 ZTS가 처리.
- ZTS FLOW.md에 구현 전략 정리됨.

### 7. Babel 플러그인: 폴백 유지

```
사용자 코드 (.tsx)
├── babel 플러그인 설정 있음 → Babel 거친 후 → ZTS
└── babel 플러그인 설정 없음 → ZTS 직행 (빠름)
```

- `reanimated/plugin` 등 서드파티 Babel 플러그인은 ZTS가 대체 불가.
- 대부분 파일은 ZTS 직행, Babel 설정된 파일만 폴백.
- Babel 폴백이 있어도 Metro(전체 Babel) 대비 ~9배 빠름.
- 주요 RN 플러그인은 점진적으로 ZTS 네이티브 구현 예정.

## 성능 비교 (예상)

파일 500개, Flow 파일 200개 프로젝트 기준:

```
Metro (전체 Babel):
  500 × 25ms = 12,500ms

Rolldown + JS 플러그인 (현재 oxc-bundler):
  번들링(Rust)           200ms
  Flow 스트리핑(Babel)   200 × 15ms = 3,000ms
  SWC ES5               500 × 2ms  = 1,000ms
  Rust↔JS 경계 오버헤드  500 × 4 × 0.5ms = 1,000ms
  합계                   ~5,200ms

ZTS (전부 네이티브):
  파싱+변환+번들링       500 × 0.3ms = 150ms
  Flow 포함              200 × 0.2ms = 40ms
  합계                   ~200ms
```

핵심 개선: Flow 스트리핑에서 Babel 제거 + 언어 경계(Rust↔JS) 왕복 제거.

## Bungae 코드 변경

### 새 번들러 추가

```
packages/bungae/src/bundler/
├── graph-bundler/     # 기존 유지
├── bun-bundler/       # 기존 유지
├── oxc-bundler/       # 기존 유지
└── zts-bundler/       # 새로 추가
    ├── index.ts       # 엔트리 (re-export)
    ├── types.ts       # 타입 정의 (빌드 결과 + NAPI 인터페이스)
    ├── binding.ts     # NAPI addon 로더 (플랫폼별 .node 파일)
    ├── bundler.ts     # 빌드 함수 (config → ZTS 옵션 매핑 + 후처리)
    ├── babel-fallback.ts  # 사용자 Babel 플러그인 콜백
    ├── prelude.ts     # __DEV__ 등 전역 변수 + 플랫폼 확장자
    ├── polyfills.ts   # RN 폴리필 경로 해석
    ├── sourcemap.ts   # 소스맵 후처리 (x_google_ignoreList)
    └── server/
        └── index.ts   # 개발 서버 (TODO)
```

### Config 변경

```typescript
// bungae.config.ts
export default {
  bundler: 'zts',  // 새 옵션
  // ...
};
```

### 기존 번들러 정리

ZTS 안정화 후 단계적으로:
1. `bun-bundler` 제거 (이미 보류 상태)
2. `oxc-bundler` 제거 (ZTS가 동일 역할)
3. `graph-bundler` 폴백으로 유지 또는 제거 (결정 보류)

## ZTS 사전 작업 (우선순위순)

| 순서 | 작업 | 설명 |
|------|------|------|
| 1 | NAPI 바인딩 | `bundle()`, `incrementalUpdate()` API. Bungae 통합의 기초 |
| 2 | Flow 파서 | Flow 문법 파싱 + 타입 스트리핑. RN 필수 |
| 3 | 플랫폼 resolver | `.ios.js`, `.android.js`, `.native.js` 확장자 해석 |
| 4 | Asset 모듈 | 이미지/폰트 → `module.exports = {uri, width, height}` |
| 5 | RN prelude 주입 | `__DEV__`, `process.env.NODE_ENV`, 폴리필 순서 |
| 6 | Babel 폴백 연동 | NAPI에서 "Babel 필요" 시그널 → Bun에서 처리 → 결과 반환 |

## 바이너리 배포 (미결정)

ZTS NAPI addon을 사용자에게 전달하는 방식:

| 방식 | 예시 | 비고 |
|------|------|------|
| 플랫폼별 optional dependency | esbuild (`@esbuild/darwin-arm64`) | 가장 일반적 |
| postinstall 다운로드 | Prisma | npm 정책 변경 리스크 |
| npm에 prebuilt 포함 | 단순 | 패키지 크기 큼 |

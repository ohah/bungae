# Dev Server & HMR

개발 서버 및 Hot Module Replacement 구현 가이드.

구현 위치:

- ZTS: `packages/bungae/src/bundler/zts-bundler/server/index.ts`
- graph: `packages/bungae/src/bundler/graph-bundler/server/index.ts`

---

## HTTP 서버

### Node `http.createServer()` 사용

ZTS / graph 두 번들러 모두 Node 표준 `http.createServer()` 기반.

이유:

- `@react-native/dev-middleware` 가 connect-style middleware 시그니처(`(req, res, next)`)를 요구
- Metro `server.enhanceMiddleware` 호환을 위해 동일 시그니처 필요
- WebSocket(`ws` 모듈)의 `noServer: true` 모드 + `httpServer.on('upgrade', ...)` 패턴이 가장 안정적

WebSocket은 `ws` 모듈의 `WebSocketServer({ noServer: true })` 를 별도로 만들고 `httpServer.on('upgrade')` 에서 수동으로 라우팅.

### 라우트 구조 (ZTS 기준)

| 경로 | 처리 |
| --- | --- |
| `/index.bundle?platform=...` | 번들 응답. `Accept: multipart/mixed` 시 progress + chunk 형식, 그 외엔 plain JS |
| `/index.bundle.map` / `/index.map` | 소스맵 |
| `/symbolicate` (POST) | 스택 트레이스 심볼리케이션 + `symbolicator.customizeFrame` 적용 |
| `/assets/*` / `/node_modules/*` | 정적 에셋 |
| `/status` | `packager-status:running` (RN healthcheck) |
| `/reload` | 모든 클라이언트 reload 브로드캐스트 |
| `/devmenu` | 개발 메뉴 열기 |
| `/open-url` (POST) | URL 열기 |
| `/json/*`, `/open-debugger`, `/debugger-frontend/*`, `/launch-js-devtools` | `@react-native/dev-middleware` 위임 |
| `/hot` (WebSocket) | HMR 클라이언트 연결 |

dev-middleware 경로 prefix 매칭은 `devMiddlewarePathPrefixes` 배열 기반.

### 멀티 플랫폼

ZTS는 `?platform=` 쿼리에 따라 플랫폼별 ZTS 프로세스를 on-demand 스폰. 첫 요청 시 lazy spawn → 이후 캐싱.

```
iOS 요청 → ZTS 프로세스 (iOS) 그래프
Android 요청 → ZTS 프로세스 (Android) 그래프
```

---

## Metro 호환 hook

ZTS dev server에 통합된 Metro 호환 hook들 (모두 `bungae.config.ts`에서 사용).

### `server.enhanceMiddleware(middleware, server) => middleware`

기본 핸들러를 connect-style middleware로 래핑한 뒤, 사용자 함수로 한번 더 감싸 최종 HTTP 핸들러로 사용. Rozenite 같은 도구가 `/rozenite/*` 라우트를 가로채고 나머지는 `next()` 위임.

```typescript
const baseMiddleware = (req, res, next) => {
  handleRequest(req, res).then(
    () => {
      if (!res.headersSent && !res.writableEnded) next();
    },
    (err) => next(err),
  );
};
const enhanced = server.enhanceMiddleware(baseMiddleware, {});
const httpServer = createHttpServer((req, res) => {
  enhanced(req, res, (err) => {
    if (err) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    } else if (!res.headersSent) {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });
});
```

두 번째 인자(`server`)는 Metro의 `MetroServer` 슬롯에 대응. Bungae는 Metro-shaped server 객체가 없으므로 빈 객체를 전달 — 플러그인은 opaque로 취급해야 함.

### `server.rewriteRequestUrl(url) => url`

요청 시작 시점에 `req.url`을 재작성. Metro의 `_rewriteAndNormalizeUrl` 패턴 동일 (jsc-safe normalize → user rewrite → 다시 normalize).

```typescript
if (req.url) {
  const normalized = jscSafeUrl.toNormalUrl(req.url);
  const rewritten = server.rewriteRequestUrl(normalized);
  req.url = jscSafeUrl.toNormalUrl(rewritten);
}
```

### `symbolicator.customizeFrame(frame)`

`/symbolicate` 응답의 각 frame에 대해 호출. `{ collapse: true }` 반환 시 DevTools에서 해당 프레임을 collapse 표시(기본 숨김, 클릭으로 펼침).

```typescript
const customization = await customizeFrame({
  file: resolved.file ?? null,
  lineNumber: resolved.lineNumber ?? null,
  column: resolved.column ?? null,
  methodName: resolved.methodName ?? null,
});
if (customization?.collapse) resolved.collapse = true;
```

자세한 매트릭스: `CLAUDE.md` 의 "ZTS Metro Config Hook 매트릭스" 섹션.

---

## HMR (Hot Module Replacement)

### 아키텍처

```
[File Change] → [Watcher] → [Rebuild] → [WebSocket /hot] → [Client]
```

두 번들러는 **HMR 프로토콜이 다름** — 클라이언트 런타임도 각각 별도.

### ZTS HMR 프로토콜 (자체)

ZTS는 자체 메시지 타입을 사용. NAPI `--watch` 모드의 `onRebuild` 콜백에서 변경 분석 후 클라이언트로 전송.

| 메시지 | 시점 |
| --- | --- |
| `hmr:update-start` | 업데이트 시작 |
| `hmr:update` (`{ modules: [...] }`) | 변경 모듈 코드 전송 |
| `hmr:update-done` | 업데이트 완료 |
| `hmr:reload` | 그래프 구조 변경 시 전체 리로드 |

서버 → 클라이언트 예시:

```typescript
sendToClients({ type: 'hmr:update-start' });
sendToClients({ type: 'hmr:update', modules: event.updates });
sendToClients({ type: 'hmr:update-done' });
```

빌드 실패 시 Metro 호환 에러 형식:

```typescript
{ type: 'error', body: { type: 'BuildError', message, errors: [...] } }
```

클라이언트: `bundler/zts-bundler/runtime/zts-hmr-client.js`. 번들에 자동 주입 (resolve-time `napi-plugins.ts` onLoad).

### graph HMR 프로토콜 (Metro 호환)

graph 번들러는 Metro의 `HMRClient.js`를 그대로 사용하기 위해 Metro 프로토콜과 1:1 호환:

| 메시지 | 시점 |
| --- | --- |
| `update-start` | 업데이트 시작 |
| `update` (`{ revisionId, added, modified, deleted, ... }`) | 모듈 추가/수정/삭제 |
| `update-done` | 완료 |
| `error` | 빌드 실패 |

이 방식을 선택한 이유는 `CLAUDE.md` 의 "HMR 구현 전략" 섹션 참고 (Metro 호환 채택).

### 콘솔 포워딩 (ZTS)

앱의 `console.log/info/warn/error/debug` → WebSocket → 터미널 출력. HMR 클라이언트가 console을 인터셉트하여 `{ type: 'log', level, data }` 메시지 전송.

서버는 레벨별 색상 뱃지(`LOG`/`WARN`/`ERROR` 등) + 오브젝트 pretty-print로 출력.

---

## Fast Refresh

React 컴포넌트 상태를 유지하면서 코드 변경 반영. ZTS / graph 모두 지원.

요구사항:

- `react-refresh` 패키지 (의존성 그래프에서 자동 포함)
- 컴포넌트 함수가 PascalCase
- 한 파일에 한 컴포넌트 권장

### 동작 방식

```
[Component Change] → [Babel react-refresh transform]
    → [HMR update-start]
    → [Module replace]
    → [react-refresh runtime: re-render only changed components, preserve state]
    → [HMR update-done]
```

ZTS는 `reactRefresh: true` NAPI 옵션으로 활성화 (`napi-build.ts:150`).

---

## 파일 감시 (Watcher)

### ZTS: NAPI 내장 watch

ZTS 바이너리가 의존성 그래프 기반으로 자체 watch. JS 측은 `onRebuild` 콜백만 받음.

```typescript
const { handle } = watchWithNapi(platformConfig, outputPath, {
  onReady(event) { /* 초기 빌드 완료 */ },
  onRebuild(event) { /* 증분 빌드 + HMR 메시지 전송 */ },
});
```

⚠️ **`watchFolders` 미적용**: NAPI 옵션에 watch folder 추가 인터페이스가 없어, 그래프 외부 폴더 변경은 감지 안 됨. ZTS Zig 측 작업 필요.

### graph: file-watcher.ts

`bundler/file-watcher.ts` 의 `createFileWatcher()` 사용:

- 파일 변경 감지 → 디바운스 → HMR 트리거
- 원자적 쓰기(VSCode rename) 처리
- JS/TS/JSON 소스만 필터링
- 기본 디바운스 300ms

`watchFolders` config 필드를 그대로 인식.

---

## 터미널 단축키 (Terminal Keyboard Shortcuts)

Metro 호환 단축키. 두 번들러 모두 동일하게 지원.

구현: `packages/bungae/src/bundler/graph-bundler/terminal-actions.ts` (ZTS 서버에서도 import해서 사용).

| 키 | 동작 |
| --- | --- |
| `r` | Reload (전체 앱 리로드) |
| `d` | Open Dev Menu |
| `i` | Open iOS Simulator |
| `a` | Open Android Emulator |
| `j` | Open Chrome DevTools |
| `c` | Clear cache |

활성화 조건:

- `config.dev === true`
- `server.useGlobalHotkey !== false` (기본 `true`)
- stdin이 TTY

stdin raw mode + 키 매핑. Ctrl+C(`\u0003`) 입력 시 정상 shutdown 트리거.

```typescript
// bungae.config.ts
export default {
  server: {
    useGlobalHotkey: true, // 기본값: true. false면 단축키 비활성화
  },
};
```

⚠️ 파이프/리다이렉션 등 non-TTY 환경에서는 자동 비활성화.

---

## DevTools 통합

`@react-native/dev-middleware` 를 dynamic import (`graph-bundler/server/dev-middleware.ts:loadDevMiddleware`). 두 번들러 모두 사용.

제공되는 라우트(prefix 매칭으로 위임):

- `/json/*` — DevTools target list
- `/open-debugger` — Fusebox 열기
- `/debugger-frontend/*` — Fusebox frontend 정적 파일
- `/launch-js-devtools` — Chrome DevTools

WebSocket endpoint도 dev-middleware에서 제공 → `httpServer.on('upgrade')` 에서 prefix로 라우팅.

Rozenite 같은 도구는 `server.enhanceMiddleware` + `@react-native/dev-middleware` monkey-patch로 패치된 `/rn_fusebox.html` 을 추가 서빙. (`CLAUDE.md` 의 Rozenite 섹션 참고)

---

## 참고 코드

- ZTS Server: `packages/bungae/src/bundler/zts-bundler/server/index.ts`
- graph Server: `packages/bungae/src/bundler/graph-bundler/server/index.ts`
- ZTS HMR client: `packages/bungae/src/bundler/zts-bundler/runtime/zts-hmr-client.js`
- 단축키: `packages/bungae/src/bundler/graph-bundler/terminal-actions.ts`
- dev-middleware loader: `packages/bungae/src/bundler/graph-bundler/server/dev-middleware.ts`
- file-watcher: `packages/bungae/src/bundler/file-watcher.ts`
- Metro Server (참고): `reference/metro/packages/metro/src/Server.js`
- Metro HMR (참고): `reference/metro/packages/metro/src/HmrServer.js`
- Rollipop Server (참고): `reference/rollipop/packages/rollipop/src/server/`

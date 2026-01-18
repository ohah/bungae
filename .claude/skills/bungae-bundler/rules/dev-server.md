# Dev Server & HMR

개발 서버 및 Hot Module Replacement 구현 가이드.

---

## 개발 서버

### Bun.serve() 사용

```typescript
const server = Bun.serve({
  port: config.server.port,
  hostname: config.server.host,

  async fetch(req) {
    const url = new URL(req.url);

    // 번들 요청
    if (url.pathname.endsWith('.bundle')) {
      return handleBundleRequest(req);
    }

    // 에셋 요청
    if (isAssetRequest(url.pathname)) {
      return handleAssetRequest(req);
    }

    // 소스맵 요청
    if (url.pathname.endsWith('.map')) {
      return handleSourceMapRequest(req);
    }

    return new Response('Not Found', { status: 404 });
  },

  // WebSocket (HMR)
  websocket: {
    message(ws, message) {
      /* HMR 메시지 처리 */
    },
    open(ws) {
      /* 클라이언트 연결 */
    },
    close(ws) {
      /* 클라이언트 연결 해제 */
    },
  },
});
```

### 번들 요청 처리

```
GET /index.bundle?platform=ios&dev=true
```

쿼리 파라미터:

- `platform`: ios | android
- `dev`: true | false
- `minify`: true | false
- `modulesOnly`: true | false (HMR용)

---

## HMR (Hot Module Replacement)

### 아키텍처

```
[File Change] → [Watcher] → [Rebuild] → [WebSocket] → [Client]
```

### WebSocket 메시지 형식

```typescript
// 서버 → 클라이언트
interface HMRUpdate {
  type: 'update';
  body: {
    added: Module[];
    modified: Module[];
    deleted: number[]; // module IDs
  };
}

interface HMRError {
  type: 'error';
  body: {
    type: string;
    message: string;
    stack?: string;
  };
}
```

### 클라이언트 런타임

```javascript
// runtime/hmr-client.js
const ws = new WebSocket(`ws://${host}:${port}/hot`);

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'update':
      applyUpdate(message.body);
      break;
    case 'error':
      showError(message.body);
      break;
  }
};

function applyUpdate({ added, modified, deleted }) {
  // 1. 삭제된 모듈 제거
  deleted.forEach((id) => delete modules[id]);

  // 2. 수정/추가된 모듈 적용
  [...added, ...modified].forEach((module) => {
    modules[module.id] = module;
    // Hot accept 콜백 실행
    if (module.hot?.accept) {
      module.hot.accept();
    }
  });
}
```

---

## Fast Refresh

React 컴포넌트 상태를 유지하면서 코드 변경 반영.

### 요구사항

- react-refresh 패키지 필요
- 컴포넌트 함수가 PascalCase로 시작해야 함
- 하나의 파일에 하나의 컴포넌트 권장

### 동작 방식

```
[Component Change] → [Transform with react-refresh] → [HMR Update]
                                                           ↓
                                                   [Re-render only changed component]
                                                   [Preserve state]
```

---

## 파일 감시 (Watcher)

### Bun 네이티브 방식

```typescript
import { watch } from 'fs';

const watcher = watch(projectRoot, { recursive: true }, (event, filename) => {
  if (shouldIgnore(filename)) return;

  // 디바운스
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    handleFileChange(filename);
  }, config.watcher.debounce);
});
```

### 설정

```typescript
watcher: {
  ignore: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
  ],
  usePolling: false,  // WSL에서는 true 필요
  debounce: 100,      // ms
}
```

---

## 참고 코드

- Metro Server: `reference/metro/packages/metro/src/Server.js`
- Metro HMR: `reference/metro/packages/metro/src/HmrServer.js`
- Rollipop Server: `reference/rollipop/packages/rollipop/src/server/`

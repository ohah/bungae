---
title: 개발 서버
description: dev server 동작 + 옵션
---

## 시작

```bash
bungae start --platform ios
# 또는 platform 없이 (멀티 플랫폼 동시 서빙)
bungae start
```

기본 port `8081` (Metro와 동일). RN 앱은 자동으로 이 주소를 fetch.

## 라우트

| 라우트                                        | 동작                              |
| --------------------------------------------- | --------------------------------- |
| `GET /index.bundle?platform=ios&dev=true`     | iOS bundle (multipart/mixed 응답) |
| `GET /index.bundle?platform=android&dev=true` | Android bundle                    |
| `GET /assets/...`                             | 정적 에셋                         |
| `WS /`                                        | HMR 메시지 채널                   |
| `POST /symbolicate`                           | 스택 트레이스 심볼리케이션        |
| `GET /open-stack-frame?file=...&line=N`       | IDE에서 파일 열기                 |

`server.enhanceMiddleware` 로 wrap하면 추가 라우트 등록 가능 (예: `withRozenite()` 가 `/rozenite/*` 와 `/rn_fusebox.html` 추가).

## 멀티 플랫폼 동시 서빙

iOS / Android 두 플랫폼이 동시에 같은 dev server를 사용. 첫 요청 시 platform별 ZTS 프로세스가 lazy spawn:

```
GET /index.bundle?platform=ios     → ios ZTS 프로세스 spawn (한 번)
GET /index.bundle?platform=android → android ZTS 프로세스 spawn (한 번)
```

## 콘솔 포워딩

앱의 `console.log/info/warn/error/debug` 를 dev server 터미널로 전달:

```
LOG       App.tsx:42 — User clicked button
WARN      App.tsx:55 — Deprecated API
ERROR     App.tsx:78 — Failed to fetch
```

Metro 스타일 레벨 뱃지. 객체 / 배열은 pretty-print. WebSocket 채널로 인터셉트 → 색상 입혀서 출력.

비활성화하려면:

```ts
server: {
  forwardClientLogs: false,
}
```

## 터미널 단축키

| 키  | 동작                  |
| --- | --------------------- |
| `r` | Reload (앱 리로드)    |
| `d` | Open Dev Menu         |
| `i` | Open iOS Simulator    |
| `a` | Open Android Emulator |
| `j` | Open Chrome DevTools  |
| `c` | Clear cache           |

비활성화:

```ts
server: {
  useGlobalHotkey: false,
}
```

## 에러 오버레이

Build / runtime 에러는 RN LogBox에 Metro 호환 형식으로 전송:

- 파일 / 라인 / 컬럼 자동 추출 (ZTS 에러 메시지 파싱)
- Symbolication: source map으로 사용자 코드 위치 매핑
- 코드 프레임 (해당 라인 + 주변 컨텍스트)

## 옵션

```ts
server: {
  port: 8081,
  host: 'localhost',          // '0.0.0.0' 으로 LAN 접근 허용
  https: false,
  key: '',
  cert: '',

  useGlobalHotkey: true,      // r/d/j/i/a/c
  forwardClientLogs: true,    // console forwarding
  verifyConnections: false,

  // Connect 미들웨어 wrap (예: Rozenite, custom routes)
  enhanceMiddleware: (mw, server) => {
    return wrapWithMyTool(mw);
  },

  // URL 재작성 (jsc-safe normalize 후 호출)
  rewriteRequestUrl: (url) => {
    if (url.startsWith('/old-path')) return url.replace('/old-path', '/index');
    return url;
  },

  // Dev 콘솔 에러 패턴 무음 처리
  silentConsoleErrorPatterns: [
    '^Some noisy warning regex$',
  ],
}
```

## CLI 인자

```bash
bungae start --port 8082 --host 0.0.0.0   # 포트/호스트 지정
bungae start --https --key key.pem --cert cert.pem
bungae start --no-interactive             # 단축키 비활성
bungae start --reset-cache                # 캐시 초기화 후 시작
```

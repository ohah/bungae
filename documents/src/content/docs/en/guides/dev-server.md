---
title: Dev Server
description: How the dev server works and what options it accepts.
---

## Start

```bash
bungae start --platform ios
# or without platform (serves multiple platforms simultaneously)
bungae start
```

Default port `8081` (same as Metro). The RN app fetches from this address automatically.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /index.bundle?platform=ios&dev=true` | iOS bundle (multipart/mixed response) |
| `GET /index.bundle?platform=android&dev=true` | Android bundle |
| `GET /assets/...` | Static assets |
| `WS /` | HMR message channel |
| `POST /symbolicate` | Stack trace symbolication |
| `GET /open-stack-frame?file=...&line=N` | Open file in IDE |

Wrap with `server.enhanceMiddleware` to register additional routes (for example, `withRozenite()` adds `/rozenite/*` and `/rn_fusebox.html`).

## Multi-platform serving

iOS and Android share the same dev server. On the first request, a per-platform ZTS process is lazily spawned:

```
GET /index.bundle?platform=ios     → spawn ios ZTS process (once)
GET /index.bundle?platform=android → spawn android ZTS process (once)
```

## Console forwarding

App-side `console.log/info/warn/error/debug` is forwarded to the dev server terminal:

```
LOG       App.tsx:42 — User clicked button
WARN      App.tsx:55 — Deprecated API
ERROR     App.tsx:78 — Failed to fetch
```

Metro-style level badges. Objects and arrays are pretty-printed. Logs are intercepted over the WebSocket channel and printed with color.

To disable:

```ts
server: {
  forwardClientLogs: false,
}
```

## Terminal shortcuts

| Key | Action |
| --- | --- |
| `r` | Reload (reload the app) |
| `d` | Open Dev Menu |
| `i` | Open iOS Simulator |
| `a` | Open Android Emulator |
| `j` | Open Chrome DevTools |
| `c` | Clear cache |

To disable:

```ts
server: {
  useGlobalHotkey: false,
}
```

## Error overlay

Build and runtime errors are sent to the RN LogBox in a Metro-compatible format:

- File / line / column extracted automatically (parsed from ZTS error messages)
- Symbolication: maps to user code locations using source maps
- Code frames (the offending line plus surrounding context)

## Options

```ts
server: {
  port: 8081,
  host: 'localhost',          // use '0.0.0.0' to allow LAN access
  https: false,
  key: '',
  cert: '',

  useGlobalHotkey: true,      // r/d/j/i/a/c
  forwardClientLogs: true,    // console forwarding
  verifyConnections: false,

  // Wrap Connect middleware (e.g. Rozenite, custom routes)
  enhanceMiddleware: (mw, server) => {
    return wrapWithMyTool(mw);
  },

  // Rewrite URLs (called after jsc-safe normalize)
  rewriteRequestUrl: (url) => {
    if (url.startsWith('/old-path')) return url.replace('/old-path', '/index');
    return url;
  },

  // Silence dev console error patterns
  silentConsoleErrorPatterns: [
    '^Some noisy warning regex$',
  ],
}
```

## CLI flags

```bash
bungae start --port 8082 --host 0.0.0.0   # set port/host
bungae start --https --key key.pem --cert cert.pem
bungae start --no-interactive             # disable shortcuts
bungae start --reset-cache                # reset cache before start
```

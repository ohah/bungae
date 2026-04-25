---
title: Installation
description: Install Bungae and run your first build (under 5 minutes)
---

## Prerequisites

| Requirement | Version |
| --- | --- |
| **Bun** | 1.3+ |
| **React Native** | 0.74+ (0.85 recommended) |
| **Node.js** | 20+ (used for parts of the CLI compatibility layer) |

Xcode for iOS and Android Studio + Gradle for Android need to be installed as usual.

## Install

```bash
bun add bungae
```

That's it. Peer deps like `react-native` and `@react-native/babel-preset` come from your existing RN project.

## Fastest start (zero config)

Works without a `bungae.config.ts` file:

```bash
# start the dev server
bun bungae start --platform ios

# production bundle
bun bungae bundle --platform ios --minify
```

The first build log shows what was auto-detected:

```
[bungae] expo: auto (detected expo@55.0.0)
```

Or, for vanilla RN:

```
[bungae] expo: off (no expo dependency in package.json)
```

→ If `package.json` lists `expo` / `expo-router` as a direct dependency, the `withExpo()` integration is enabled automatically. No false positives from hoisted packages in monorepos.

## Explicit config file (recommended)

Zero config works fine, but as projects grow an explicit file is clearer:

```bash
bun bungae init
```

This generates `bungae.config.ts` automatically:

```
✓ wrote bungae.config.ts
  detected expo@55.0.0 → wrapped with withExpo()
✓ added "start:bungae" to package.json scripts
✓ added "build:bungae" to package.json scripts
✓ added .bungae/ to .gitignore

Done. Try `bungae start` or `bungae bundle --platform ios`.
```

The generated file:

```ts
// bungae.config.ts
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { defineConfig, withExpo } from 'bungae';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default withExpo(defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
}));
```

## Register CLI shortcuts (optional)

In `package.json`:

```json
{
  "scripts": {
    "start": "bungae start",
    "ios": "bun start --platform ios",
    "android": "bun start --platform android",
    "bundle:ios": "bungae bundle --platform ios",
    "bundle:android": "bungae bundle --platform android"
  }
}
```

→ `bungae init` adds `start:bungae` / `build:bungae` automatically, but it doesn't overwrite the standard RN CLI scripts (`start`, `ios`, etc.) — add those manually if you need them.

## Verify it works

```bash
bun bungae start --platform ios
```

You should see output like this:

```
⚡ Bungae v0.0.x · Metro-compatible React Native bundler
[bungae] expo: ...
✓ ZTS native transformer ready
✓ Listening on http://localhost:8081
  Press r to reload, d for dev menu, j for DevTools

BUNDLE  [ios] ./index.js (1595 files, 8235.2 KB, 2329ms)
```

If `http://localhost:8081/index.bundle?platform=ios&dev=true` returns 200 in a browser, you're good.

## Next steps

- [Quick start](/bungae/guides/quick-start/) — your first dev session
- [Config file](/bungae/guides/config-file/) — options in detail
- [Expo integration](/bungae/guides/expo/) — what `withExpo()` fills in

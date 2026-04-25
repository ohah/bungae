---
title: Quick start
description: From your first dev session to a production bundle
---

Assumes an RN project with `bungae` installed (see the [installation guide](/bungae/guides/installation/)).

## 1) Start the dev server

```bash
bun bungae start --platform ios
```

Run the RN app in another terminal:

```bash
# iOS
bun ios
# Android
bun android
```

The app fetches `http://localhost:8081/index.bundle?platform=ios`. When the first screen appears, you're set.

### Shortcuts (Metro-compatible)

| Key | Action |
| --- | --- |
| `r` | Reload (reload the app) |
| `d` | Open Dev Menu |
| `i` | Open iOS Simulator |
| `a` | Open Android Emulator |
| `j` | Open Chrome DevTools |
| `c` | Clear cache |

## 2) Edit code → HMR

Save a change to `App.tsx`:

```tsx
export default function App() {
  return <Text>Hello, Bungae</Text>;  // edit
}
```

→ The app updates instantly. Component state is preserved (Fast Refresh).

Adding `console.log(...)` prints to the dev server terminal in real time (console forwarding).

## 3) Build a production bundle

```bash
bun bungae bundle --platform ios --minify
```

Output:

```
✅ Bundle written to: .bungae/main.jsbundle
   Size: 3580 KB
   Bundler: Bungae v0.0.x
   Dev mode: false, Platform: ios
   📦 Copied to: ios/main.jsbundle
   ✅ iOS bundle ready for Xcode build
```

→ Then run the Xcode Release build, or a Gradle release.

## 4) Source maps / debugging

```bash
bun bungae bundle --platform ios --minify \
  --sourcemap-output ./ios/main.jsbundle.map
```

Stack traces in DevTools map back to your source location (`App.tsx:60`) accurately. `node_modules` paths are added to the ignore list automatically, so debugging stays free of noise.

## 5) For Expo projects

`bungae init` and zero-config mode auto-detect Expo. To wire it up explicitly:

```ts
// bungae.config.ts
import { defineConfig, withExpo } from 'bungae';

export default withExpo(defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
}));
```

See [Expo integration](/bungae/guides/expo/) for details.

## Common gotchas

| Symptom | Cause / fix |
| --- | --- |
| `Cannot find module` (RN library) | Add the monorepo root `node_modules`: `resolver.nodeModulesPaths: [join(__dirname, '../../node_modules')]` |
| `View config not found for component X` | RN 0.85+ Fabric. Bungae invokes `@react-native/babel-plugin-codegen` automatically — invalidate the cache and rebuild: `bun bungae start --reset-cache` |
| Expo polyfills not applied | Missing `withExpo()` wrapper, or no `expo` dependency in `package.json` |
| Recurring `silentConsoleErrorPatterns` warning | `withExpo()` adds the winter polyfill patterns automatically. You can also add them manually via ServerConfig.silentConsoleErrorPatterns |

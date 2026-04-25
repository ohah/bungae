---
title: Introduction
description: What Bungae is and the problems it solves
---

**Bungae** is a Metro-compatible React Native bundler. It calls the [ZTS](https://github.com/ohah/zts) transpiler — written in Zig — in-process via NAPI, and runs on top of the [Bun](https://bun.sh) runtime.

## In one sentence

> **Metro-compatible interface + Zig core = 5x faster builds**, with zero migration cost.

## What's different

Metro's biggest strength is its tight integration with the React Native ecosystem. Bundle format, HMR protocol, plugin interface, Babel transformer chain — these are all the shapes RN libraries expect. Bungae **keeps all of that intact**.

Only the heavy parts have been swapped out:

| Stage | Metro | Bungae |
| --- | --- | --- |
| Transformer | Babel (worker pool) | **ZTS (Zig, in-process NAPI)** |
| Bundler | Metro (Node.js) | **ZTS (Zig)** |
| HTTP/WS Server | metro-server (Connect) | **Bun.serve()** |
| File I/O | Node fs | **Bun.file()** |
| HMR Protocol | Metro standard | **Metro standard (unchanged)** |
| HMR Client | RN built-in HMRClient.js | **RN built-in HMRClient.js (unchanged)** |
| Dev middleware | @react-native/dev-middleware | **unchanged** |

ZTS handles TypeScript, JSX, Flow, and even Reanimated worklets entirely in Zig — without Babel. The key idea is to take the shortest path needed to transform a single line of code — parser, type stripper, code generator — and make all of it native.

## Who it's for

- ✅ **RN apps already building with Metro** — almost no migration needed
- ✅ **Expo projects** — one line `withExpo()` automatically applies winter polyfills, metro-runtime, and expo-image/sqlite assetExts
- ✅ **Monorepos** — handles workspace hoisting without false positives
- ✅ **Teams where dev speed is critical** — shorter HMR cycles, 5x faster fresh builds

## Design principles

1. **Metro compatibility first** — migration cost must be zero
2. **Incremental native migration** — replace Babel with ZTS step by step, even where Babel is still in use
3. **Bun-native first** — all runtime I/O, HTTP, and file handling uses Bun APIs
4. **Explicit integrations** — integrations like Expo are opt-in via wrappers like `withExpo()`. Monorepo-safe.

## Next steps

- [Why it's fast](/bungae/guides/why-fast/) — the 5x figure broken down quantitatively
- [Installation](/bungae/guides/installation/) — get started in 5 minutes
- [Architecture overview](/bungae/guides/architecture/) — the pipeline at a glance

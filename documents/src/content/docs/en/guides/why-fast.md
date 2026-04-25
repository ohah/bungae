---
title: Why it's fast
description: The quantitative basis and mechanisms behind Bungae's 5x speedup over Metro
---

## Measured numbers

ExampleApp (RN 0.85, 1595 files, iOS, production minified):

| Bundler | Mode | Build time | Bundle size |
| --- | --- | --- | --- |
| **Bungae (ZTS)** | dev | **2329 ms** | 8235 KB |
| **Bungae (ZTS)** | production minified | **2215 ms** | 3580 KB |
| Metro | development | 12506 ms | 8437 KB |
| Metro | production minified | 11547 ms | 2076 KB |

→ **5.2× shorter build time** (production).

## Four reasons it's fast

### 1. Native Zig transpiler (ZTS)

Babel is a general-purpose transformer, so its hot path is heavy. Every transform runs over JS object trees, and each file walks the plugin chain via the visitor pattern. Even after JIT warmup, GC pressure and function call overhead pile up.

**ZTS is a single-pass transpiler written in Zig:**

- Custom lexer + parser (`packages/zts/packages/core/src/`)
- No AST object allocations — direct arena-based processing
- TypeScript type annotations / JSX / Flow are all handled in a single walk
- Output is emitted directly to a byte buffer

The biggest win comes from collapsing the cost Babel pays for the same file (parse → traverse N plugins → print) into a single stage.

### 2. NAPI in-process call (no subprocess)

ZTS is loaded into Bun as a `.node` native addon. That means **no subprocess fork and no IPC pipe** for each file transform. You call Zig functions just like calling JS functions.

Comparison:

- esbuild: Go binary with stdin/stdout communication → small IPC cost
- swc: NAPI in-process (same structure as ZTS)
- Babel: pure JS, no NAPI
- Metro: Babel on top of a worker pool — worker process spawn + IPC

A single NAPI hop costs roughly 0.05–0.3ms, so the cumulative impact stays small even with many files.

### 3. Bun runtime

The dev server uses Bun's APIs directly:

- **Bun.serve()** — unified HTTP + WebSocket. Faster than Connect/express middleware. Metro's metro-server uses Node http + ws as separate layers
- **Bun.file()** — lazy-loaded, single system call to read. More zero-copy paths than Node fs
- **Bun itself** — JS execution is faster than Node (cold start, JSC engine)

This is why `bungae start` brings up the dev server in milliseconds.

### 4. Transform cache + on-demand multi-platform

- iOS / Android dev servers run in parallel. ZTS processes are spawned lazily on first request
- Transform results are cached on disk in `.bungae-cache/` (PersistentCache). Rebuilds and HMR are nearly free
- On file changes, only affected modules are re-transformed (incremental build)

## What's actually on the critical path

Profiling the build, the time distribution looks roughly like this:

| Stage | Share |
| --- | --- |
| ZTS native transform (1595 files) | ~70% |
| Dependency graph build + serialize | ~20% |
| `@react-native/babel-plugin-codegen` (NativeComponent view config) | ~10% |
| Other (NAPI hop, plugin orchestration) | <1% |

ZTS itself is the critical path. In other words, the faster ZTS gets, the faster Bungae gets. ZTS is under active optimization (#1589 codegen native, mini-type-stripper, etc.).

## Apples-to-apples comparison with Metro

The "5x faster" claim is for identical inputs producing identical outputs:

- ✅ Identical: bundle format (`__d(N)/__r(N)`), HMR protocol, plugin interface, `runBeforeMainModule` order
- ✅ Identical: source maps, x_google_ignoreList, inlineSourceMap, asset registry
- ⚠️ Not compatible: a few Metro hooks (`transformer.getTransformOptions`, custom serializer, etc.) — see the [ZTS Metro Config Hook matrix in CLAUDE.md](https://github.com/ohah/bungae/blob/main/CLAUDE.md) for full compatibility

## Does the 5x apply everywhere?

- Projects that lean heavily on native RN packages (react-native-screens, reanimated, etc.) see an even bigger gap (Babel preset cost disappears)
- Small apps (fewer than 500 files) have a smaller absolute time difference, so the ratio shrinks in practice
- A single HMR cycle is in the millisecond range — that's typically where the difference feels biggest in day-to-day work

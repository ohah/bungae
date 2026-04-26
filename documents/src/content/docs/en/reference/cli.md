---
title: CLI Reference
description: Complete list of bungae CLI commands and options
---

## Basic Usage

```bash
bungae <command> [options]
```

## Commands

### `bungae init`

Generates a starter `bungae.config.{ts,js}`, adds scripts to `package.json`, and patches `.gitignore`. Auto-detects `expo` / `expo-router` dependencies in `package.json`.

```bash
bungae init             # generate bungae.config.ts
bungae init --js        # generate JavaScript config
bungae init --force     # overwrite existing config
```

Output:

```
✓ wrote bungae.config.ts
  detected expo@55.0.0 → wrapped with withExpo()
✓ added "start:bungae" to package.json scripts
✓ added "build:bungae" to package.json scripts
✓ added .bungae/ to .gitignore
```

### `bungae bundle` / `bungae build`

One-shot production bundle build.

```bash
bungae bundle --platform ios --minify
```

### `bungae start` / `bungae serve`

Start the dev server with HMR.

```bash
bungae start --platform ios
bungae start                        # serve all platforms simultaneously
```

### `bungae dependencies`

(Planned) Print the module dependency graph.

## Common Options

| Option | Description |
| --- | --- |
| `-h, --help` | Show help |
| `-v, --version` | Show version |
| `-p, --platform <ios\|android\|web>` | Target platform |
| `-d, --dev` | Development mode |
| `-m, --minify` | Minify output |
| `--mode <development\|production>` | Metro-compatible alias |
| `-e, --entry <path>` / `--entry-file <path>` | Entry file |
| `-c, --config <path>` | Config file path |
| `--root <path>` | Project root |
| `--bundler <zts\|graph>` | Bundler selection (default: `zts`, `graph` is a legacy fallback) |
| `-j, --max-workers <number>` | Worker thread count |
| `--reset-cache` | Invalidate cache |

## Server Options (start / serve)

| Option | Description |
| --- | --- |
| `--host <string>` | Bind host (default: `localhost`) |
| `--port <number>` | Port (default: `8081`) |
| `--https` | Enable HTTPS |
| `--key <path>` | SSL key file |
| `--cert <path>` | SSL certificate |
| `--no-interactive` | Disable terminal hotkeys |
| `--watchFolders <list>` | Additional watch directories (comma-separated) |
| `--sourceExts <list>` | Additional source extensions (comma-separated) |

## Build Options (bundle / build)

| Option | Description |
| --- | --- |
| `-o, --outDir <path>` | Output directory |
| `-O, --out <path>` / `--bundle-output <path>` | Output file path |
| `--bundle-encoding <utf8\|...>` | Output encoding |
| `--source-map` | Generate source maps |
| `--source-map-url <string>` | Source map URL override |
| `--sourcemap-output <path>` | Source map file path |
| `--sourcemap-sources-root <path>` | Source map sources root |
| `--sourcemap-use-absolute-path` | Use absolute paths |
| `--assets-dest <path>` | Asset output directory |
| `--asset-catalog-dest <path>` | iOS asset catalog |
| `--unstable-transform-profile <default\|hermes-stable\|hermes-canary>` | JS engine profile |
| `--transform-option <key=value>` | Custom transform option (repeatable) |
| `--resolver-option <key=value>` | Custom resolver option (repeatable) |

## init Options

| Option | Description |
| --- | --- |
| `--js` | Emit JavaScript config (default: TypeScript) |
| `--force` | Overwrite existing config |

## Environment Variables

| Variable | Description |
| --- | --- |
| `BUNGAE_HMR_PROFILE=1` | Print HMR message debug output |
| `BUNGAE_CODEGEN_PROFILE=1` | Measure RN codegen plugin time (per-file) |
| `ZTS_PROFILE=all` / `ZTS_PROFILE_LEVEL=detailed` | ZTS profiling |

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | General error |
| `130` | SIGINT (user interrupt) |

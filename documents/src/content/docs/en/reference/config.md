---
title: Config Options Reference
description: All BungaeConfig fields
---

Use inside `bungae.config.ts` or under the `bungae` key in `package.json`.

## Top-level Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | `string` | `process.cwd()` | Project root |
| `entry` | `string` | `'index.js'` | Entry file |
| `platform` | `'ios' \| 'android' \| 'web'` | `'ios'` | Target platform |
| `dev` | `boolean` | `false` | Development mode |
| `minify` | `boolean` | `false` | Minify output |
| `mode` | `'development' \| 'production'` | `'production'` | Metro-compatible alias |
| `outDir` | `string` | `'dist'` | Output directory |
| `bundler` | `'zts' \| 'graph'` | `'graph'` | **Use `'zts'` for production** |

### Build Output (CLI-compatible)

| Field | Description |
| --- | --- |
| `bundleOutput` | Output bundle path |
| `sourcemapOutput` | Source map path |
| `sourceMap` | Whether to generate source maps |
| `sourceMapUrl` | Source map URL override |
| `sourcemapSourcesRoot` | Source map sources root |
| `sourcemapUseAbsolutePath` | Use absolute paths |
| `assetsDest` | Asset output directory |
| `assetCatalogDest` | iOS asset catalog path |
| `bundleEncoding` | Encoding (e.g. `utf8`) |
| `resetCache` | Reset cache |
| `maxWorkers` | Worker thread count (`0` = auto) |
| `watchFolders` | Additional watch directories |
| `sourceExts` | Additional source extensions |
| `transformOptions` | Custom transform options |
| `resolverOptions` | Custom resolver options |
| `unstableTransformProfile` | JS engine profile |
| `interactive` | Interactive hotkeys |

## `resolver`

```ts
resolver: {
  sourceExts: string[];           // default: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json']
  assetExts: string[];             // default: many image/video/audio/font/document extensions
  platforms: string[];             // default: ['ios', 'android', 'native']
  preferNativePlatform: boolean;   // default: true
  nodeModulesPaths: string[];      // additional node_modules paths
  blockList: RegExp[];             // block patterns
  extraNodeModules: Record<string, string>;  // fallback mappings
  resolveRequest?: (ctx, name, platform) => ResolutionResult;
}
```

`resolveRequest` signature:

```ts
type CustomResolver = (
  context: {
    originModulePath: string;
    platform: string | null;
    resolveRequest: CustomResolver;  // delegate
  },
  moduleName: string,
  platform: string | null,
) => ResolutionResult;

type ResolutionResult =
  | { type: 'sourceFile'; filePath: string }
  | { type: 'assetFiles'; filePaths: readonly string[] }
  | { type: 'empty' };
```

## `transformer`

```ts
transformer: {
  minifier: 'bun' | 'terser' | 'esbuild' | 'swc';  // default: 'terser'
  inlineRequires: boolean;          // default: false (limited support)
  babelTransformerPath?: string;    // user babel transformer (e.g. svg)
  babel?: {
    presets?: (string | [string, Record<string, unknown>])[];
    plugins?: (string | [string, Record<string, unknown>])[];
  };
}
```

## `serializer`

```ts
serializer: {
  polyfills: string[];
  prelude: string[];
  bundleType: 'plain' | 'ram-indexed' | 'ram-file';  // default: 'plain' (RAM not supported)
  extraVars: Record<string, unknown>;

  getModulesRunBeforeMainModule?: (
    entryFilePath: string,
    options?: { projectRoot: string; nodeModulesPaths: string[] },
  ) => string[];

  runBeforeMainModule?: string[];   // static list (populated by withExpo)

  getPolyfills?: (options: { platform: string | null }) => string[];

  inlineSourceMap: boolean;          // default: false

  shouldAddToIgnoreList?: (module: {
    path: string;
    code: string;
    dependencies: string[];
    type?: string;
  }) => boolean;
}
```

## `server`

```ts
server: {
  port: number;                     // default: 8081
  host: string;                     // default: 'localhost'
  https: boolean;
  key: string;
  cert: string;
  useGlobalHotkey: boolean;          // default: true
  forwardClientLogs: boolean;        // default: true
  verifyConnections: boolean;
  unstable_serverRoot: string | null;

  enhanceMiddleware?: (mw: ConnectMiddleware, server: unknown) => ConnectMiddleware;
  rewriteRequestUrl?: (url: string) => string;
  silentConsoleErrorPatterns?: string[];   // RegExp source strings
}
```

## `symbolicator`

```ts
symbolicator: {
  customizeFrame?: (frame: SymbolicatorFrame) =>
    | { collapse?: boolean }
    | null
    | undefined
    | Promise<{ collapse?: boolean } | null | undefined>;
}
```

Returning `{ collapse: true }` hides the frame in DevTools.

## `experimental`

```ts
experimental: {
  treeShaking: boolean;  // default: false. Removes unused exports (risk: may break dynamic require)
}
```

## Helpers

### `defineConfig(config)`

Type inference helper. No runtime behavior.

### `withExpo(config)`

Expo integration wrapper. Automatically adds winter / metro-runtime / asset extensions / silentConsoleErrorPatterns. See [Expo integration](/bungae/guides/expo/).

### `detectExpo(projectRoot)`

Detects Expo dependencies from `package.json`. Returns `{ name: 'expo' | 'expo-router'; version: string } | undefined`. Used for zero-config auto-detection. May also be called directly.

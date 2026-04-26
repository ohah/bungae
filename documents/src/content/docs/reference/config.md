---
title: 설정 옵션 레퍼런스
description: BungaeConfig 전체 필드
---

`bungae.config.ts` 또는 `package.json` 의 `bungae` 키 안에서 사용.

## 최상위 필드

| 필드 | 타입 | 기본 | 설명 |
| --- | --- | --- | --- |
| `root` | `string` | `process.cwd()` | 프로젝트 루트 |
| `entry` | `string` | `'index.js'` | 엔트리 파일 |
| `platform` | `'ios' \| 'android' \| 'web'` | `'ios'` | 타겟 플랫폼 |
| `dev` | `boolean` | `false` | 개발 모드 |
| `minify` | `boolean` | `false` | 미니파이 |
| `mode` | `'development' \| 'production'` | `'production'` | Metro 호환 |
| `outDir` | `string` | `'dist'` | 출력 디렉토리 |
| `bundler` | `'zts' \| 'graph'` | `'zts'` | `zts`가 기본값. `graph`는 레거시 fallback |

### 빌드 출력 (CLI 호환)

| 필드 | 설명 |
| --- | --- |
| `bundleOutput` | 출력 번들 경로 |
| `sourcemapOutput` | 소스맵 경로 |
| `sourceMap` | 소스맵 생성 여부 |
| `sourceMapUrl` | 소스맵 URL override |
| `sourcemapSourcesRoot` | 소스맵 소스 루트 |
| `sourcemapUseAbsolutePath` | 절대 경로 사용 |
| `assetsDest` | 에셋 출력 디렉토리 |
| `assetCatalogDest` | iOS 에셋 카탈로그 경로 |
| `bundleEncoding` | 인코딩 (`utf8` 등) |
| `resetCache` | 캐시 초기화 |
| `maxWorkers` | 워커 스레드 수 (`0` = auto) |
| `watchFolders` | 추가 watch 디렉토리 |
| `sourceExts` | 추가 소스 확장자 |
| `transformOptions` | 커스텀 transform 옵션 |
| `resolverOptions` | 커스텀 resolver 옵션 |
| `unstableTransformProfile` | JS 엔진 프로필 |
| `interactive` | 인터랙티브 단축키 |

## `resolver`

```ts
resolver: {
  sourceExts: string[];           // 기본: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json']
  assetExts: string[];             // 기본: 이미지/비디오/오디오/폰트/문서 다수
  platforms: string[];             // 기본: ['ios', 'android', 'native']
  preferNativePlatform: boolean;   // 기본: true
  nodeModulesPaths: string[];      // 추가 node_modules 경로
  blockList: RegExp[];             // 차단 패턴
  extraNodeModules: Record<string, string>;  // fallback 매핑
  resolveRequest?: (ctx, name, platform) => ResolutionResult;
}
```

`resolveRequest` 시그니처:

```ts
type CustomResolver = (
  context: {
    originModulePath: string;
    platform: string | null;
    resolveRequest: CustomResolver;  // 위임
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
  minifier: 'bun' | 'terser' | 'esbuild' | 'swc';  // 기본: 'terser'
  inlineRequires: boolean;          // 기본: false (지원 한정)
  babelTransformerPath?: string;    // 사용자 babel transformer (svg 등)
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
  bundleType: 'plain' | 'ram-indexed' | 'ram-file';  // 기본: 'plain' (RAM 미지원)
  extraVars: Record<string, unknown>;

  getModulesRunBeforeMainModule?: (
    entryFilePath: string,
    options?: { projectRoot: string; nodeModulesPaths: string[] },
  ) => string[];

  runBeforeMainModule?: string[];   // 정적 list (withExpo가 채움)

  getPolyfills?: (options: { platform: string | null }) => string[];

  inlineSourceMap: boolean;          // 기본: false

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
  port: number;                     // 기본: 8081
  host: string;                     // 기본: 'localhost'
  https: boolean;
  key: string;
  cert: string;
  useGlobalHotkey: boolean;          // 기본: true
  forwardClientLogs: boolean;        // 기본: true
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

`{ collapse: true }` 반환 시 DevTools에서 프레임 숨김.

## `experimental`

```ts
experimental: {
  treeShaking: boolean;  // 기본: false. 미사용 export 제거 (위험: 동적 require 깨질 수 있음)
}
```

## Helper 함수

### `defineConfig(config)`

타입 추론 헬퍼. 런타임 동작 없음.

### `withExpo(config)`

Expo 통합 wrapper. winter / metro-runtime / asset extension / silentConsoleErrorPatterns 자동 추가. [Expo 통합](/bungae/guides/expo/) 참고.

### `detectExpo(projectRoot)`

`package.json` 보고 Expo 의존성 감지. `{ name: 'expo' | 'expo-router'; version: string } | undefined` 반환. Zero config 자동 감지에 사용. 사용자가 직접 호출도 가능.

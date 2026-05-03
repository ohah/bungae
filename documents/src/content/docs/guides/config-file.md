---
title: 설정 파일
description: bungae.config.ts 작성법 + 주요 옵션
---

## 파일 위치

프로젝트 루트에 다음 중 하나:

- `bungae.config.ts` (권장)
- `bungae.config.js`
- `bungae.config.json`

또는 `package.json`의 `"bungae"` 키 안에. 우선순위는 `.ts > .js > .json > package.json`.

`bungae init` 으로 자동 생성 가능.

## 최소 설정

```ts
// bungae.config.ts
import { defineConfig } from 'bungae';

export default defineConfig({
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',
});
```

## Expo 프로젝트

```ts
import { defineConfig, withExpo } from 'bungae';

export default withExpo(
  defineConfig({
    root: __dirname,
    entry: 'index.js',
    bundler: 'zts',
  }),
);
```

`withExpo()` 가 무엇을 채우는지는 [Expo 통합](/bungae/guides/expo/) 참고.

## 주요 옵션 (전체는 [레퍼런스](/bungae/reference/config/))

```ts
defineConfig({
  // 필수
  root: __dirname,
  entry: 'index.js',
  bundler: 'zts',

  // 모드
  dev: false, // CLI --dev 와 같음
  minify: true, // CLI --minify 와 같음

  // 출력
  outDir: './dist',
  bundleOutput: './ios/main.jsbundle',
  sourceMap: true,
  sourcemapOutput: './ios/main.jsbundle.map',

  // Resolver
  resolver: {
    sourceExts: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
    assetExts: ['.png', '.jpg', '.svg' /* ... */],
    platforms: ['ios', 'android', 'native'],
    preferNativePlatform: true,
    nodeModulesPaths: [
      // 모노레포 root
      join(__dirname, '../../node_modules'),
    ],
    blockList: [/\.test\./],
    extraNodeModules: {
      // Node 빌트인 폴리필 등
      crypto: require.resolve('crypto-browserify'),
    },
    resolveRequest: (ctx, name, platform) => {
      // 커스텀 해석. context.resolveRequest()로 위임.
      if (name === 'foo') {
        return { type: 'sourceFile', filePath: '/abs/path/foo.js' };
      }
      return ctx.resolveRequest(ctx, name, platform);
    },
  },

  // Transformer
  transformer: {
    minifier: 'terser', // 'bun' | 'terser' | 'esbuild' | 'swc'
    inlineRequires: false,
    babelTransformerPath: 'react-native-svg-transformer/react-native',
    babel: {
      // 사용자 babel preset/plugin이 필요한 경우 chain
      presets: [],
      plugins: [],
    },
  },

  // Serializer
  serializer: {
    polyfills: [],
    prelude: [],
    bundleType: 'plain',
    extraVars: { __MY_FLAG__: true },
    inlineSourceMap: false,
    shouldAddToIgnoreList: (mod) => mod.path.includes('node_modules'),
    runBeforeMainModule: ['/abs/path/to/some-init.js'],
  },

  // Server
  server: {
    port: 8081,
    host: 'localhost',
    useGlobalHotkey: true,
    forwardClientLogs: true,
    enhanceMiddleware: (mw, server) => {
      // Connect 미들웨어 wrap (예: withRozenite)
      return mw;
    },
    rewriteRequestUrl: (url) => url.replace('/old.bundle', '/index.bundle'),
    silentConsoleErrorPatterns: [],
  },

  // Symbolicator
  symbolicator: {
    customizeFrame: (frame) => {
      if (frame.file?.includes('react-native/')) return { collapse: true };
    },
  },

  // 실험적
  experimental: {
    treeShaking: false,
  },
});
```

## CLI 인자가 우선

`bungae bundle --platform ios --minify` 처럼 CLI에서 준 인자는 config 파일을 override합니다.

## 설정 검증

`bungae bundle ...` / `bungae start ...` 실행 시 config가 자동 검증됩니다. 잘못된 옵션이면 에러 메시지로 표시.

## Metro config에서 마이그레이션

대부분의 metro config 옵션이 같은 이름으로 그대로 동작합니다. 자세한 매핑은 [Metro에서 이관](/bungae/guides/migration/) 참고.

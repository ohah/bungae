# Config System

설정 파일 스키마, Metro 호환 hook, 마이그레이션 가이드.

원본 타입 정의: `packages/bungae/src/config/types.ts`

---

## 구현 현황

### ✅ Phase 1-1 완료

- Config 파일 로딩 (`bungae.config.ts/js/json`, `package.json`)
- Config 병합 및 기본값 처리
- Config 검증 로직
- Server config (port, useGlobalHotkey, forwardClientLogs 등)
- Metro-compatible API (`loadConfig({ config, cwd })`)
- Metro 스타일 테스트 (전 케이스 통과)

### Metro 호환 API

- ✅ `loadConfig({ config: path })` - 명시적 config 파일 경로
- ✅ `loadConfig({ cwd: dir })` - 디렉토리에서 config 검색
- ✅ Function export 지원: `module.exports = (defaultConfig) => ({ ... })`
- ✅ Async function export 지원: `module.exports = () => Promise.resolve({ ... })` (Rozenite 등)
- ✅ Promise export 지원: `module.exports = Promise.resolve({ ... })`
- ✅ Config chaining: `mergeConfig(defaults, config1, config2, ...)`

### 의도적 제외

| 항목 | 제외 이유 |
| --- | --- |
| `cacheStores` | Bun 자체 캐시 사용. 롤리팝도 동일 |
| YAML config | Metro에서도 deprecated. 신규 프로젝트 불필요 |

---

## 설정 파일

지원 형식 (우선순위 순):

```
bungae.config.ts   (권장)
bungae.config.js
bungae.config.json
package.json의 "bungae" 필드
```

---

## 전체 스키마 (BungaeConfig)

```typescript
import { defineConfig } from 'bungae';

export default defineConfig({
  // ========== 기본 ==========
  root?: string;                    // 프로젝트 루트 (기본: cwd)
  entry?: string;                   // 진입점 (기본: 'index.js')
  outDir?: string;                  // 출력 디렉토리 (기본: 'dist')
  platform?: 'ios' | 'android' | 'web';
  dev?: boolean;
  minify?: boolean;
  mode?: 'development' | 'production';
  bundler?: 'graph' | 'zts';        // 기본: 'graph'

  // ========== Build output (Metro/RN CLI 호환) ==========
  bundleOutput?: string;            // RN CLI: --bundle-output
  sourcemapOutput?: string;         // RN CLI: --sourcemap-output
  sourcemapSourcesRoot?: string;
  sourcemapUseAbsolutePath?: boolean;
  sourceMap?: boolean;
  sourceMapUrl?: string;
  assetsDest?: string;              // RN CLI: --assets-dest
  assetCatalogDest?: string;
  bundleEncoding?: BufferEncoding;
  resetCache?: boolean;
  maxWorkers?: number;
  watchFolders?: string[];          // 그래프 밖 디렉토리 watch (ZTS / graph 모두 지원)
  sourceExts?: string[];
  transformOptions?: Record<string, string>;
  resolverOptions?: Record<string, string>;
  unstableTransformProfile?: 'default' | 'hermes-stable' | 'hermes-canary';
  interactive?: boolean;

  // ========== Resolver ==========
  resolver?: {
    sourceExts?: string[];          // ['.tsx','.ts','.jsx','.js','.json',...]
    assetExts?: string[];           // ['.png','.jpg','.gif','.webp',...]
    platforms?: string[];           // ['ios','android','native']
    preferNativePlatform?: boolean;
    nodeModulesPaths?: string[];    // 모노레포 추가 node_modules 경로
    blockList?: RegExp[];
    // ⚠️ Metro의 resolveRequest / extraNodeModules 는 ZTS Zig 작업 필요로 미지원
  };

  // ========== Transformer ==========
  transformer?: {
    minifier?: 'bun' | 'terser' | 'esbuild' | 'swc';
    inlineRequires?: boolean;
    babelTransformerPath?: string;  // Metro 호환 chained transformer
    babel?: {
      presets?: (string | [string, Record<string, unknown>])[];
      plugins?: (string | [string, Record<string, unknown>])[];
    };
  };

  // ========== Serializer ==========
  serializer?: {
    polyfills?: string[];
    prelude?: string[];
    bundleType?: 'plain' | 'ram-indexed' | 'ram-file';
    extraVars?: Record<string, unknown>;
    // Metro 호환
    getModulesRunBeforeMainModule?: (
      entryFilePath: string,
      options?: { projectRoot: string; nodeModulesPaths: string[] },
    ) => string[];
    getPolyfills?: (options: { platform: string | null }) => string[];
    inlineSourceMap?: boolean;
    shouldAddToIgnoreList?: (module: {
      path: string;
      code: string;
      dependencies: string[];
      type?: string;
    }) => boolean;
  };

  // ========== Server ==========
  server?: {
    port?: number;                  // 기본: 8081
    host?: string;                  // 기본: 'localhost'
    https?: boolean;
    key?: string;                   // SSL key 경로
    cert?: string;                  // SSL cert 경로
    useGlobalHotkey?: boolean;      // 기본: true
    forwardClientLogs?: boolean;    // 기본: true
    verifyConnections?: boolean;
    unstable_serverRoot?: string | null;

    // ✨ Metro 호환 hook (ZTS 지원)
    enhanceMiddleware?: (
      middleware: ConnectMiddleware,
      server: unknown,
    ) => ConnectMiddleware;
    rewriteRequestUrl?: (url: string) => string;
  };

  // ========== Symbolicator (Metro 호환, ZTS 지원) ✨ ==========
  symbolicator?: {
    customizeFrame?: (frame: {
      file?: string | null;
      lineNumber?: number | null;
      column?: number | null;
      methodName?: string | null;
    }) =>
      | { collapse?: boolean }
      | null
      | undefined
      | Promise<{ collapse?: boolean } | null | undefined>;
  };

  // ========== Experimental ==========
  experimental?: {
    treeShaking?: boolean;          // ⚠️ 실험적
  };
});
```

---

## 설정 예시

### 기본

```typescript
import { defineConfig } from 'bungae';

export default defineConfig({
  entry: 'index.js',
  platform: 'ios',
  bundler: 'zts',
});
```

### Reanimated 사용

```typescript
import { defineConfig } from 'bungae';

export default defineConfig({
  entry: 'index.js',
  transformer: {
    babel: {
      plugins: ['react-native-reanimated/plugin'],
    },
  },
});
```

### react-native-svg-transformer (Metro 호환 chained transformer)

```typescript
import { defineConfig } from 'bungae';

export default defineConfig({
  entry: 'index.js',
  resolver: {
    sourceExts: ['.tsx', '.ts', '.jsx', '.js', '.json', '.svg'],
  },
  transformer: {
    babelTransformerPath: 'react-native-svg-transformer/react-native',
  },
});
```

### 모노레포 (workspace 호이스팅 대응)

```typescript
import { defineConfig } from 'bungae';
import path from 'path';

export default defineConfig({
  entry: 'index.js',
  resolver: {
    // 상위 workspace의 node_modules도 검색
    nodeModulesPaths: [path.resolve(__dirname, '../../node_modules')],
  },
});
```

### Rozenite (DevTools 플러그인 — `server.enhanceMiddleware`)

```typescript
import { defineConfig } from 'bungae';
import { withRozenite } from '@rozenite/metro';

const config = defineConfig({
  entry: 'index.js',
  bundler: 'zts',
});

// withRozenite가 server.enhanceMiddleware를 자동 설정
export default withRozenite(config as any, {
  enabled: true,
});
```

### URL 재작성 + 프레임 collapse

```typescript
import { defineConfig } from 'bungae';

export default defineConfig({
  entry: 'index.js',
  server: {
    // 레거시 경로 → 현행 경로 redirect
    rewriteRequestUrl: (url) => url.replace('/old.bundle', '/index.bundle'),
  },
  symbolicator: {
    // node_modules 프레임은 LogBox에서 기본 숨김
    customizeFrame: (frame) => {
      if (frame.file?.includes('/node_modules/')) {
        return { collapse: true };
      }
      return undefined;
    },
  },
});
```

### 환경별 분기 (function export)

```typescript
import { defineConfig } from 'bungae';

export default defineConfig(({ mode, platform }) => ({
  entry: 'index.js',
  platform,
  ...(mode === 'production' && {
    transformer: {
      minifier: 'terser',
      inlineRequires: true,
    },
  }),
}));
```

---

## Metro 마이그레이션 매트릭스

ZTS 번들러 기준 (`bundler: 'zts'`).

### ✅ 동일 시그니처로 그대로 사용 가능

| Metro | Bungae | 비고 |
| --- | --- | --- |
| `resolver.sourceExts` / `assetExts` / `platforms` / `blockList` | 동일 | 그대로 |
| `transformer.babelTransformerPath` | 동일 | chained transformer (decorator pattern) |
| `serializer.getModulesRunBeforeMainModule` | 동일 | RN `InitializeCore` 자동 |
| `serializer.getPolyfills` | 동일 | — |
| `serializer.shouldAddToIgnoreList` | 동일 | x_google_ignoreList 커스터마이징 |
| `server.port` / `host` / `useGlobalHotkey` / `forwardClientLogs` | 동일 | — |
| `server.enhanceMiddleware` | 동일 | ✨ Rozenite 등 그대로 동작 |
| `server.rewriteRequestUrl` | 동일 | ✨ jsc-safe normalize 처리 포함 |
| `symbolicator.customizeFrame` | 동일 | ✨ `{ collapse: true }` LogBox 동작 |

### ⚠️ 구조 변경 / 단순화

| Metro | Bungae | 비고 |
| --- | --- | --- |
| `transformer.minifierPath` | `transformer.minifier` | enum (`'bun'\|'terser'\|'esbuild'\|'swc'`) |
| `cacheVersion` / `cacheStores` | (자체 캐시 시스템) | 의도적 제외 |
| `resetCache` | `resetCache` 또는 CLI `--reset-cache` | — |

### 🚧 ZTS 미지원 (Zig 작업 필요)

| Metro | 차단 이유 |
| --- | --- |
| `resolver.resolveRequest` | ZTS resolver가 Zig에서 컴파일됨. JS 콜백 호출 메커니즘 부재 |
| `resolver.extraNodeModules` | NAPI BuildOptions에 옵션 자체 없음 |
| `watchFolders` | NAPI watch는 그래프 외부 폴더 추가 옵션 부재 (현재 빈 배열 hardcoded) |
| `transformer.getTransformOptions` / `assetPlugins` | transformation은 Zig 측 책임 |
| `serializer.customSerializer` / `processModuleFilter` / `createModuleIdFactory` | 직렬화도 Zig 측 책임 |

### ⏸ 보류 (낮은 우선순위)

| Metro | 사유 |
| --- | --- |
| `reporter` | `ReportableEvent` 인터페이스 거대 (20+ 종) + ROI 낮음 |
| `symbolicator.customizeStack` | `customizeFrame`만으로 대부분 커버 |

### ❌ 의도적 제외

| Metro | 사유 |
| --- | --- |
| `cacheStores` | Bun 자체 캐시 사용 |
| YAML config | Metro에서도 deprecated |

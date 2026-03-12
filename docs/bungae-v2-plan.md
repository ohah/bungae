# Bungae v2 — OXC(Rolldown) 기반 React Native 번들러

## 요약

Bungae v2는 OXC(Rolldown)를 코어 번들러로 채택하여 Metro를 대체하는 React Native 번들러입니다.
Rolldown의 `strictExecutionOrder`를 통해 ESM 실행 순서를 보장하고,
Hermes 바이트코드 사전 컴파일 통합으로 차별화합니다.

## 왜 OXC(Rolldown)인가

### 번들러 비교

| 번들러 | ESM 순서 보장 | 속도 | RN 지원 | 상태 |
|--------|:------------:|:----:|:-------:|:----:|
| Metro | `__d()/__r()` DFS | 느림 | 공식 | 안정 |
| Bun.build | 없음 | 빠름 | 없음 | 제한적 |
| esbuild | 없음 | 빠름 | 없음 | 안정 |
| Rspack | 없음 (Webpack 방식) | 빠름 | Re.Pack | 안정 |
| **Rolldown** | **`strictExecutionOrder`** | **매우 빠름** | **없음** | **실험적** |

### 핵심 선택 이유

1. **`strictExecutionOrder: true`** — ESM spec 레벨에서 모듈 실행 순서 보장. React Native는 `InitializeCore → react → react-native → App` 순서가 틀어지면 크래시남. 이 옵션을 명시적으로 지원하는 번들러는 Rolldown이 유일함.

2. **Rust 네이티브 성능** — 그래프 빌드, 모듈 해석, 코드 변환, 직렬화를 전부 Rust로 처리. JS 기반 번들러(graph-bundler)와 비교 불가능한 속도.

3. **ESM + Scope Hoisting** — Metro의 `__d()/__r()` 래핑 없이 ESM 출력. 더 작은 번들, 더 나은 tree shaking.

## 경쟁 분석

### Rollipop과의 차별점

Rollipop도 Rolldown 기반이지만, Bungae v2는 다음을 제공합니다:

| 기능 | Rollipop | Bungae v2 |
|------|:--------:|:---------:|
| Rolldown 코어 | ✅ | ✅ |
| Flow 처리 | ✅ | ✅ |
| HMR | ✅ | ✅ |
| **Hermes 사전 컴파일** | ❌ | ✅ |
| **번들 분석 내장** | ❌ | ✅ |
| **원격 캐시** | ❌ | ✅ |
| **Code Splitting (RN 특화)** | ❌ | ✅ (Phase 3) |
| **Zero-Config** | ❌ | ✅ |

## 아키텍처

```
bungae.config.ts (설정)
       ↓
  ┌─────────────────────────────────────────────┐
  │  Bungae Core                                │
  │                                             │
  │  Entry (index.js/tsx)                       │
  │       ↓                                     │
  │  [Rolldown] ── strictExecutionOrder: true   │
  │       │                                     │
  │       ├─ Resolution (플랫폼별 확장자)       │
  │       ├─ Transformation (플러그인 체인)     │
  │       │   ├─ TS/TSX/JSX → Rolldown 내장     │
  │       │   ├─ Flow → hermes-parser + Babel   │
  │       │   ├─ Assets → Metro 호환 등록       │
  │       │   └─ JSON → export 변환             │
  │       └─ Serialization (ESM, scope hoist)   │
  │       ↓                                     │
  │  index.bundle (JS)                          │
  │       ↓                                     │
  │  [Hermes Compiler] ── hermesc               │
  │       ↓                                     │
  │  index.hbc (바이트코드)                     │
  └─────────────────────────────────────────────┘
```

### 모듈 구조

```
packages/bungae/src/
├── config/              # 설정 시스템 (기존 유지)
├── bundler/
│   ├── graph-bundler/   # v1 (Babel, Metro 호환, 유지보수)
│   └── oxc-bundler/     # v2 (Rolldown 기반)
│       ├── rolldown.ts      # Rolldown 설정 및 실행
│       ├── plugins/
│       │   ├── flow-strip.ts        # Flow → JS 변환
│       │   ├── asset.ts             # 에셋 처리 (이미지, 폰트)
│       │   ├── json.ts              # JSON 모듈
│       │   ├── prelude.ts           # RN 전역 변수 주입
│       │   ├── react-refresh.ts     # Fast Refresh (dev)
│       │   └── platform-resolver.ts # .ios.ts/.android.ts 해석
│       ├── hermes/
│       │   ├── compiler.ts          # hermesc 통합
│       │   └── source-map.ts        # Hermes 소스맵 체이닝
│       ├── hmr/
│       │   ├── server.ts            # WebSocket HMR 서버
│       │   └── runtime.ts           # 클라이언트 HMR 런타임
│       ├── server/
│       │   └── index.ts             # 개발 서버
│       ├── analyze/
│       │   └── index.ts             # 번들 분석
│       └── cache/
│           ├── local.ts             # 로컬 디스크 캐시
│           └── remote.ts            # 원격 캐시 (S3 등)
├── serializer/          # 기존 (graph-bundler용, v2에서는 미사용)
└── transformer/         # 기존 (graph-bundler용, v2에서는 미사용)
```

## 구현 계획

### Phase 1: 코어 번들링 (4주)

**목표: `bunx bungae build`로 RN 앱 번들 생성**

#### 1-1. Rolldown 통합 (1주)

```typescript
// oxc-bundler/rolldown.ts
import { rolldown } from '@rollipop/rolldown';

export async function bundle(config: BungaeConfig) {
  const build = await rolldown({
    input: config.entry,
    output: {
      format: 'esm',
      strictExecutionOrder: true,
      codeSplitting: false,
    },
    resolve: {
      extensions: buildExtensions(config.platform),
      mainFields: ['react-native', 'browser', 'main'],
      conditionNames: ['react-native', 'import', 'require'],
    },
    plugins: [
      preludePlugin(config),
      flowStripPlugin(config),
      assetPlugin(config),
      jsonPlugin(),
      platformResolverPlugin(config),
    ],
  });
  return build;
}
```

#### 1-2. 플러그인 구현 (1주)

| 플러그인 | 역할 | 구현 방식 |
|---------|------|----------|
| `prelude` | RN 전역 변수 (`__DEV__`, `ErrorUtils` 등) | intro 주입 |
| `flow-strip` | Flow 타입 제거 | hermes-parser + flow-remove-types |
| `asset` | 이미지/폰트 → AssetRegistry 모듈 | onLoad 훅 |
| `json` | JSON → export default | onLoad 훅 |
| `platform-resolver` | `.ios.ts` / `.android.ts` 해석 | onResolve 훅 |

#### 1-3. 프로덕션 빌드 (1주)

- Tree shaking (Rolldown 내장)
- Minification (Rolldown 내장 또는 Terser)
- Source map 생성
- 에셋 목록 추출

#### 1-4. Hermes 사전 컴파일 통합 (1주)

```typescript
// hermes/compiler.ts
export async function compileToHermesBytecode(options: {
  input: string;      // JS 번들 경로
  output: string;     // .hbc 출력 경로
  sourceMap: boolean;
  optimize: boolean;
}): Promise<HermesCompileResult>
```

- `react-native/sdks/hermesc/` 에서 hermesc 자동 탐색
- 번들링 완료 직후 hermesc 실행
- 소스맵 체이닝 (JS 소스맵 + Hermes 소스맵 병합)
- 결과: `.hbc` 파일 직접 출력

**Phase 1 결과물:**
```bash
$ bunx bungae build --platform ios

  Bundling...    2.1s (3,000 modules, Rolldown)
  Hermes...     28.4s → index.hbc (3.1MB)
  Done!         30.5s

  Output:
    dist/index.bundle      5.2MB (JS)
    dist/index.hbc         3.1MB (bytecode)
    dist/index.hbc.map     8.4MB (source map)
    dist/assets/           42 files
```

---

### Phase 2: 개발 환경 (4주)

**목표: `bunx bungae start`로 HMR 지원 개발 서버 실행**

#### 2-1. 개발 서버 (1주)

- HTTP 서버 (번들/에셋/소스맵 서빙)
- `@react-native/dev-middleware` 통합 (DevTools)
- `@react-native-community/cli-server-api` 통합 (reload/devMenu)
- 상태 엔드포인트 (`/status`)

#### 2-2. HMR 구현 (2주)

Rolldown의 `dev()` API(실험적) 활용:

```typescript
// Rolldown dev API로 증분 빌드
const engine = await rolldown.dev({
  input: config.entry,
  // ... Rolldown 설정
});

// 파일 변경 감지 → 증분 빌드 → HMR 전송
engine.onUpdate((update) => {
  if (update.type === 'Patch') {
    wsClients.forEach(client => {
      client.send({ type: 'hmr:update', code: update.code });
    });
  } else if (update.type === 'FullReload') {
    wsClients.forEach(client => {
      client.send({ type: 'hmr:reload' });
    });
  }
});
```

HMR 런타임 (클라이언트에 주입):
- `module.hot.accept()` 지원
- React Refresh 통합 (Fast Refresh)
- WebSocket 연결 관리
- 에러 오버레이 표시

#### 2-3. React Refresh 통합 (0.5주)

- Rolldown 플러그인으로 React Refresh boundary 자동 삽입
- 컴포넌트 변경 시 상태 유지하면서 코드 업데이트
- 비-컴포넌트 변경 시 Full Reload 폴백

#### 2-4. 터미널 UI (0.5주)

- 빌드 진행률 표시 (Metro 스타일)
- 터미널 단축키 (`r` 리로드, `d` 개발 메뉴, `j` DevTools)
- 에러 포매팅

**Phase 2 결과물:**
```bash
$ bunx bungae start --platform ios

  ⚡ Bungae v2.0.0

  Dev server running at http://0.0.0.0:8081
  HMR endpoint: ws://0.0.0.0:8081/hot

  Shortcuts:
    r - Reload  d - Dev Menu  j - DevTools
    i - iOS Sim  a - Android Emu  c - Clear cache

  BUNDLE index.tsx ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100% (3000/3000) 2.1s
```

---

### Phase 3: 차별화 기능 (4주)

#### 3-1. 번들 분석 내장 (1주)

```bash
$ bunx bungae analyze --platform ios
```

```
┌──────────────────────────────────────────────────┐
│  Bundle Analysis — iOS Production                │
├──────────────────────────────────────────────────┤
│  Total: 2.8MB (1.1MB gzipped)                    │
│  Modules: 3,000                                  │
│  Hermes bytecode: 1.8MB                          │
│                                                  │
│  react-native      892KB  ██████████░░  31%      │
│  @react-navigation  340KB ████░░░░░░░░  12%      │
│  lodash            284KB  ███░░░░░░░░░  10%      │
│  moment            267KB  ███░░░░░░░░░   9%      │
│  your code         180KB  ██░░░░░░░░░░   6%      │
│  other             837KB  █████████░░░  32%      │
│                                                  │
│  Suggestions:                                    │
│  ⚠ moment (267KB) → date-fns (32KB)  -235KB     │
│  ⚠ lodash (284KB) → lodash-es + tree shake       │
│  ⚠ 12 duplicate packages detected                │
└──────────────────────────────────────────────────┘
```

- 모듈별 크기 분석 (Rolldown 메타데이터 활용)
- 중복 패키지 감지
- 대체 라이브러리 제안
- HTML 리포트 내보내기 (선택)

#### 3-2. 영구 캐시 + 원격 캐시 (1.5주)

```typescript
// bungae.config.ts
export default {
  cache: {
    type: 'filesystem',
    directory: '.bungae-cache',

    // 원격 캐시 (팀 공유)
    remote: {
      provider: 's3',
      bucket: 'my-bungae-cache',
      region: 'ap-northeast-2',
    },
  },
}
```

동작 방식:
```
빌드 시:
  1. 모듈 해시 계산 (소스 + 설정 + 의존성)
  2. 로컬 캐시 확인 → 히트면 스킵
  3. 원격 캐시 확인 → 히트면 다운로드
  4. 미스면 변환 후 로컬 + 원격에 저장

팀원 A가 빌드 → 캐시 업로드
팀원 B가 빌드 → 캐시 다운로드 → 변환 스킵
CI 빌드 → 이전 빌드 캐시 활용 → 빠른 빌드
```

#### 3-3. Zero-Config 자동 감지 (0.5주)

```bash
# 설정 파일 없이 RN 프로젝트 자동 감지
$ bunx bungae start

  Detected React Native project (0.76.1)
  Platform: ios (auto-detected from Xcode project)
  Entry: index.js
  Hermes: enabled (react-native >= 0.70)

  Starting dev server...
```

- `package.json`에서 react-native 버전 감지
- `ios/`, `android/` 폴더에서 플랫폼 감지
- `app.json`에서 엔트리 포인트 감지
- Hermes 활성화 여부 자동 판단

#### 3-4. Code Splitting (RN 특화) (1주)

```typescript
// bungae.config.ts
export default {
  codeSplitting: {
    enabled: true,
    strategy: 'route-based',

    // 지정한 경로의 파일을 별도 chunk로 분리
    routes: {
      'screens/Settings': 'settings.chunk',
      'screens/Profile': 'profile.chunk',
    },

    // 앱 시작 시 미리 로드할 chunk
    preload: ['screens/Home'],

    // chunk 로딩 방식
    loader: 'fetch',  // fetch API로 chunk 다운로드
  },
}
```

런타임 로더:
```javascript
// Bungae가 자동 주입하는 chunk 로더
globalThis.__bungae_loadChunk = async (chunkName) => {
  const response = await fetch(`${serverUrl}/${chunkName}.bundle`);
  const code = await response.text();
  eval(code);  // 또는 Function()으로 실행
};
```

---

## 설정 파일 (최종)

```typescript
// bungae.config.ts
import { defineConfig } from 'bungae';

export default defineConfig({
  // 기본 설정 (대부분 자동 감지)
  entry: 'index.js',
  platform: 'ios',

  // Hermes 통합 (킬러 피처)
  hermes: {
    precompile: true,
    optimize: true,
    sourceMap: true,
  },

  // 캐시
  cache: {
    type: 'filesystem',
    remote: {
      provider: 's3',
      bucket: 'my-cache',
    },
  },

  // Code Splitting (선택)
  codeSplitting: {
    enabled: false,  // 기본 OFF
    strategy: 'route-based',
  },

  // 개발 서버
  server: {
    port: 8081,
  },

  // 플러그인 (확장)
  plugins: [],
});
```

## 지원 버전

### React Native

**타겟 버전: RN 0.83**

현재 예제 앱이 RN 0.83이므로, 이 버전만 타겟합니다.
향후 다른 버전 지원이 필요하면 그때 확장합니다.

- New Architecture (Bridgeless) 기본값
- TypeScript 전환 진행 중 (Flow 처리 부담 감소)
- Hermes 기본 엔진

### Hermes 경로

```typescript
// require.resolve로 react-native 위치를 정확하게 찾기
// 모노레포(yarn workspaces, pnpm, npm)에서도 패키지 매니저에 관계없이 동작
function findHermesc(projectRoot: string): string | null {
  try {
    const rnPackageJson = require.resolve('react-native/package.json', {
      paths: [projectRoot],
    });
    const rnRoot = dirname(rnPackageJson);
    const platform = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'win64' : 'linux64';
    const hermescPath = join(rnRoot, 'sdks/hermesc', `${platform}-bin`, 'hermesc');

    if (existsSync(hermescPath)) return hermescPath;
    return null;
  } catch {
    return null; // react-native를 찾을 수 없음
  }
  // null 반환 시 graceful degradation: Hermes 컴파일 스킵, JS 번들만 출력
}
```

hermesc 바이너리가 존재하지 않거나 실행 실패 시 Hermes 컴파일을 스킵하고 JS 번들만 출력합니다 (graceful degradation).

---

## 테스트 전략

**원칙: 모든 로직은 반드시 테스트로 검증한다.**

테스트 없이 머지되는 코드는 없습니다. 각 Phase의 기능은 해당 Phase 내에서 테스트 작성까지 완료해야 합니다.

### 테스트 프레임워크

- **테스트 러너**: `bun test` (Bun 내장 테스트 러너)
- **Assertion**: `expect` (Bun 내장)
- **E2E**: 실제 RN 프로젝트 fixtures를 사용한 통합 테스트

### Phase별 테스트 범위

#### Phase 1: 코어 번들링 테스트

**1-1. Rolldown 통합 테스트**

```typescript
// __tests__/oxc-bundler/rolldown.test.ts
describe('Rolldown bundling', () => {
  test('bundles entry point with all dependencies', async () => {
    const result = await bundle(fixtureConfig);
    expect(result.code).toBeDefined();
    expect(result.code.length).toBeGreaterThan(0);
  });

  test('strictExecutionOrder preserves module order', async () => {
    // InitializeCore → react → react-native → App 순서 검증
    const result = await bundle(fixtureConfig);
    const initCoreIdx = result.code.indexOf('InitializeCore');
    const reactIdx = result.code.indexOf('react');
    const appIdx = result.code.indexOf('App');
    expect(initCoreIdx).toBeLessThan(reactIdx);
    expect(reactIdx).toBeLessThan(appIdx);
  });

  test('generates valid source map', async () => {
    const result = await bundle({ ...fixtureConfig, dev: true });
    expect(result.map).toBeDefined();
    const sourceMap = JSON.parse(result.map!);
    expect(sourceMap.version).toBe(3);
    expect(sourceMap.sources.length).toBeGreaterThan(0);
  });

  test('tree shakes unused exports in production', async () => {
    const result = await bundle({ ...fixtureConfig, dev: false });
    expect(result.code).not.toContain('unusedExport');
  });
});
```

**1-2. 플러그인 단위 테스트**

```typescript
// __tests__/oxc-bundler/plugins/flow-strip.test.ts
describe('Flow strip plugin', () => {
  test('strips @flow annotations', async () => { ... });
  test('handles opaque type declarations', async () => { ... });
  test('handles type cast expressions', async () => { ... });
  test('preserves non-Flow JS files', async () => { ... });
  test('handles declare module syntax', async () => { ... });
});

// __tests__/oxc-bundler/plugins/asset.test.ts
describe('Asset plugin', () => {
  test('transforms PNG import to AssetRegistry call', async () => { ... });
  test('reads image dimensions correctly', async () => { ... });
  test('generates correct httpServerLocation', async () => { ... });
  test('handles assets in nested directories', async () => { ... });
});

// __tests__/oxc-bundler/plugins/platform-resolver.test.ts
describe('Platform resolver plugin', () => {
  test('resolves .ios.ts for iOS platform', async () => { ... });
  test('resolves .android.ts for Android platform', async () => { ... });
  test('falls back to .native.ts', async () => { ... });
  test('falls back to .ts when no platform file exists', async () => { ... });
  test('handles index files in directories', async () => { ... });
});

// __tests__/oxc-bundler/plugins/prelude.test.ts
describe('Prelude plugin', () => {
  test('injects __DEV__ as true in dev mode', async () => { ... });
  test('injects __DEV__ as false in production', async () => { ... });
  test('injects ErrorUtils global', async () => { ... });
  test('injects Platform.OS with correct platform', async () => { ... });
});
```

**1-3. Hermes 컴파일 테스트**

```typescript
// __tests__/oxc-bundler/hermes/compiler.test.ts
describe('Hermes compiler', () => {
  test('finds hermesc binary from react-native', () => {
    const hermescPath = findHermesc(fixtureProjectRoot);
    expect(hermescPath).not.toBeNull();
  });

  test('compiles JS bundle to .hbc', async () => {
    const result = await compileToHermesBytecode({
      input: fixtureBundlePath,
      output: tmpHbcPath,
      sourceMap: false,
      optimize: true,
    });
    expect(existsSync(result.hbcPath)).toBe(true);
    // HBC magic number 검증 (Hermes bytecode 시그니처)
    const buffer = readFileSync(result.hbcPath);
    expect(buffer[0]).toBe(0xc6); // Hermes bytecode magic
  });

  test('generates source map when requested', async () => {
    const result = await compileToHermesBytecode({
      input: fixtureBundlePath,
      output: tmpHbcPath,
      sourceMap: true,
      optimize: false,
    });
    expect(result.sourceMapPath).toBeDefined();
    expect(existsSync(result.sourceMapPath!)).toBe(true);
  });

  test('gracefully handles missing hermesc', async () => {
    const result = findHermesc('/nonexistent/path');
    expect(result).toBeNull();
    // hermesc 없으면 JS 번들만 출력, 크래시 안 함
  });
});
```

**1-4. E2E 빌드 테스트**

```typescript
// __tests__/oxc-bundler/e2e/build.test.ts
describe('E2E: Production build', () => {
  test('builds minimal RN app fixture', async () => {
    // fixtures/minimal-app/ 에 최소 RN 프로젝트 준비
    const result = await buildWithOxc(minimalAppConfig);
    expect(result.code).toContain('react');
    expect(result.code).toContain('react-native');
    expect(result.assets).toBeDefined();
  });

  test('bundle executes without errors in Hermes', async () => {
    const result = await buildWithOxc(minimalAppConfig);
    // hermesc로 컴파일 가능한지 검증 (구문 오류 없음)
    const hermesResult = await compileToHermesBytecode({
      input: writeTempBundle(result.code),
      output: tmpHbcPath,
      sourceMap: false,
      optimize: false,
    });
    expect(hermesResult.hbcPath).toBeDefined();
  });

  test('TypeScript files are transformed correctly', async () => { ... });
  test('Flow files fall back to Babel correctly', async () => { ... });
  test('assets are extracted correctly', async () => { ... });
});
```

#### Phase 2: 개발 환경 테스트

**2-1. 개발 서버 테스트**

```typescript
// __tests__/oxc-bundler/server/server.test.ts
describe('Dev server', () => {
  test('serves bundle at /index.bundle', async () => { ... });
  test('serves source map at /index.map', async () => { ... });
  test('serves assets at /assets/*', async () => { ... });
  test('returns status at /status', async () => { ... });
  test('handles /reload endpoint', async () => { ... });
  test('handles /symbolicate endpoint', async () => { ... });
});
```

**2-2. HMR 테스트**

```typescript
// __tests__/oxc-bundler/hmr/hmr.test.ts
describe('HMR', () => {
  test('WebSocket connection established on /hot', async () => { ... });
  test('sends hmr:update on file change', async () => { ... });
  test('sends hmr:reload on structural change', async () => { ... });
  test('handles multiple connected clients', async () => { ... });
  test('debounces rapid file changes', async () => { ... });
  test('sends error message on build failure', async () => { ... });
});
```

**2-3. React Refresh 테스트**

```typescript
// __tests__/oxc-bundler/hmr/react-refresh.test.ts
describe('React Refresh', () => {
  test('wraps components with refresh boundary', async () => { ... });
  test('non-component changes trigger full reload', async () => { ... });
  test('preserves component state on update', async () => { ... });
});
```

#### Phase 3: 차별화 기능 테스트

**3-1. 번들 분석 테스트**

```typescript
// __tests__/oxc-bundler/analyze/analyze.test.ts
describe('Bundle analyzer', () => {
  test('calculates module sizes correctly', async () => { ... });
  test('detects duplicate packages', async () => { ... });
  test('generates size report', async () => { ... });
});
```

**3-2. 캐시 테스트**

```typescript
// __tests__/oxc-bundler/cache/cache.test.ts
describe('Build cache', () => {
  test('caches build result to disk', async () => { ... });
  test('invalidates cache on file change', async () => { ... });
  test('invalidates cache on config change', async () => { ... });
  test('second build is faster with cache hit', async () => { ... });
});
```

**3-3. Code Splitting 테스트**

```typescript
// __tests__/oxc-bundler/code-splitting/splitting.test.ts
describe('Code Splitting', () => {
  test('splits routes into separate chunks', async () => { ... });
  test('core chunk contains shared dependencies', async () => { ... });
  test('chunk loader works at runtime', async () => { ... });
  test('preloaded chunks are included in initial bundle', async () => { ... });
});
```

### 테스트 Fixtures

```
packages/bungae/src/bundler/__tests__/
├── fixtures/
│   ├── minimal-app/           # 최소 RN 앱 (App.tsx + index.js)
│   │   ├── index.js
│   │   ├── App.tsx
│   │   └── package.json
│   ├── flow-app/              # Flow 코드 포함 앱
│   │   ├── index.js
│   │   ├── FlowComponent.js   # @flow 주석 포함
│   │   └── package.json
│   ├── assets-app/            # 에셋 포함 앱
│   │   ├── index.js
│   │   ├── image.png
│   │   └── package.json
│   ├── multi-screen-app/      # Code Splitting 테스트용
│   │   ├── index.js
│   │   ├── screens/
│   │   │   ├── Home.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── Profile.tsx
│   │   └── package.json
│   └── hermes-bundle/         # Hermes 컴파일 테스트용
│       └── index.bundle       # 미리 생성된 JS 번들
```

### CI 테스트 파이프라인

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test                    # 전체 단위 테스트

  e2e-test:
    runs-on: macos-latest                # Hermes는 macOS에서 테스트
    steps:
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test --filter "e2e"     # E2E 테스트만

  rn-compat-test:
    strategy:
      matrix:
        rn-version: ['0.74', '0.75', '0.76']
    runs-on: macos-latest
    steps:
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: |
          # 해당 RN 버전으로 fixture 설치
          cd fixtures/minimal-app
          bun add react-native@${{ matrix.rn-version }}
      - run: bun test --filter "e2e"     # RN 버전별 호환성 테스트
```

### 커버리지 목표

| 영역 | 최소 커버리지 | 비고 |
|------|:-----------:|------|
| 플러그인 (flow, asset, resolver) | **90%** | 핵심 변환 로직, 엣지 케이스 많음 |
| Hermes 컴파일러 | **85%** | 외부 바이너리 의존, 에러 핸들링 중요 |
| 개발 서버 | **80%** | HTTP/WS 핸들러 |
| HMR | **80%** | 증분 빌드 + 메시지 전송 |
| 캐시 | **85%** | 무효화 로직 정확해야 함 |
| 번들 분석 | **75%** | 리포팅 UI는 테스트 제외 가능 |
| E2E (빌드 → Hermes → 실행) | **필수** | RN 버전별 최소 1개 시나리오 |

---

## 마일스톤

| Phase | 기간 | 목표 | 결과물 |
|-------|------|------|--------|
| **Phase 1** | 4주 | 프로덕션 빌드 + Hermes | `bunx bungae build` |
| **Phase 2** | 4주 | 개발 서버 + HMR | `bunx bungae start` |
| **Phase 3** | 4주 | 차별화 기능 | analyze, cache, code splitting |
| **Phase 4** | 2주 | 안정화 + 문서화 | v2.0.0 릴리스 |

**총 예상 기간: 14주 (약 3.5개월)**

각 Phase 완료 조건: **기능 구현 + 해당 Phase 테스트 전체 통과**

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Rolldown API 변경 | 높음 | 버전 고정, 어댑터 레이어 |
| Rolldown `dev()` API 불안정 | 중간 | Phase 2에서 자체 watch 구현 폴백 |
| Hermes 버전 호환성 | 낮음 | hermesc 버전 감지 + 폴백 |
| RN 신규 버전 대응 | 중간 | RN 릴리스 추적, CI 테스트 |

## 기존 코드 활용

v1(graph-bundler)에서 재사용 가능한 것:
- `config/` — 설정 시스템 (확장하여 사용)
- `server/handlers/` — HTTP 핸들러 (에셋, 소스맵, 심볼리케이션)
- `terminal-actions.ts` — 터미널 단축키
- `terminal-reporter.ts` — 빌드 진행률 표시
- `file-watcher.ts` — 파일 변경 감지

v1에서 사용하지 않는 것:
- `serializer/` — `__d()/__r()` 기반 (ESM으로 대체)
- `transformer/` — Babel 기반 (Rolldown + OXC로 대체)
- `graph-bundler/graph.ts` — 자체 그래프 (Rolldown이 처리)

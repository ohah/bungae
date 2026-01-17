# 번들링 프로세스 (3단계)

Bungae는 Metro와 동일한 3단계 번들링 파이프라인을 따릅니다.

```
Entry File → [Resolution] → [Transformation] → [Serialization] → Bundle
```

---

## 1. Resolution (모듈 해석)

모듈 import/require 경로를 실제 파일 경로로 해석합니다.

### 지원 기능

| 기능 | 설명 | 예시 |
|------|------|------|
| 상대 경로 | `./`, `../` | `import './utils'` |
| npm 패키지 | node_modules 탐색 | `import 'lodash'` |
| 스코프 패키지 | @scope/package | `import '@react-native/core'` |
| 플랫폼별 확장자 | `.ios.js`, `.android.js`, `.native.js` | `Button.ios.tsx` |
| Package exports | `package.json` exports 필드 | `"exports": { ".": "./src/index.js" }` |
| Browser field | `package.json` browser 필드 | `"browser": { "fs": false }` |
| react-native field | RN 전용 진입점 | `"react-native": "./src/native.js"` |

### 해석 우선순위

```typescript
// platform: 'ios' 일 때 해석 순서
const extensions = [
  '.ios.tsx', '.ios.ts', '.ios.jsx', '.ios.js',
  '.native.tsx', '.native.ts', '.native.jsx', '.native.js',
  '.tsx', '.ts', '.jsx', '.js',
  '.json',
];
```

### 설정 옵션

```typescript
resolver: {
  sourceExts: string[];           // 소스 파일 확장자
  assetExts: string[];            // 에셋 파일 확장자
  platforms: string[];            // 지원 플랫폼
  extraNodeModules: Record<string, string>;  // 추가 모듈 경로
  nodeModulesPaths: string[];     // node_modules 검색 경로
  blockList: RegExp[];            // 제외 패턴
  resolveRequest?: CustomResolver; // 커스텀 리졸버
}
```

---

## 2. Transformation (코드 변환)

소스 코드를 React Native 런타임이 실행 가능한 형태로 변환합니다.

### 기본 변환 (Bun 내장)

Bun의 네이티브 트랜스파일러로 처리 (가장 빠름):

- TypeScript → JavaScript
- TSX/JSX → JavaScript
- ES Modules 구문 처리

### Babel 선택적 통합

특수 플러그인이 필요한 경우만 Babel 사용:

```typescript
transformer: {
  // 기본: Bun 트랜스파일러
  default: 'bun',

  // Babel 필요한 패키지만 지정
  babel: {
    include: [
      '**/node_modules/react-native-reanimated/**',
      '**/node_modules/react-native-gesture-handler/**',
    ],
    plugins: [
      'react-native-reanimated/plugin',
    ],
  },
}
```

### Babel이 필요한 케이스

| 라이브러리 | 이유 | 플러그인 |
|-----------|------|---------|
| react-native-reanimated | worklet 변환 (UI 스레드 분리) | `react-native-reanimated/plugin` |
| styled-components | displayName 주입 | `babel-plugin-styled-components` |
| @babel/plugin-proposal-decorators | 데코레이터 문법 | `@babel/plugin-proposal-decorators` |
| Flow 코드 | Flow 타입 제거 | `@babel/preset-flow` |

---

## 3. Serialization (번들 직렬화)

변환된 모듈들을 하나의 번들 파일로 합칩니다.

### 번들 형식

| 형식 | 용도 | 특징 |
|------|------|------|
| **Plain Bundle** | 기본, 개발용 | 모든 모듈을 하나의 JS 파일로 |
| **Indexed RAM Bundle** | iOS 프로덕션 | 바이너리 형식, 빠른 로딩 |
| **File RAM Bundle** | Android 프로덕션 | 모듈별 파일 분리 |

### Plain Bundle 구조

```javascript
// 1. Polyfills
(function() { /* polyfill code */ })();

// 2. Module definitions
__d(function(require, module, exports) {
  // module 0: entry
}, 0, [1, 2]);

__d(function(require, module, exports) {
  // module 1: dependency
}, 1, []);

// 3. Entry point execution
__r(0);
```

### 설정 옵션

```typescript
serializer: {
  polyfills: string[];              // 폴리필 목록
  prelude: string[];                // 프리루드 파일
  getModulesRunBeforeMainModule: () => string[];
  createModuleIdFactory: () => (path: string) => number;
  processModuleFilter: (module: Module) => boolean;
}
```

---

## 파이프라인 흐름 예시

```
index.tsx
    ↓ Resolution
[index.tsx, ./App.tsx, react, react-native, ...]
    ↓ Transformation (parallel)
[transformed module 0, module 1, module 2, ...]
    ↓ Serialization
bundle.js (+ bundle.js.map)
```

## 참고

- Metro Resolution: `reference/metro/packages/metro-resolver/`
- Metro Transformer: `reference/metro/packages/metro-transform-worker/`
- Metro Serializer: `reference/metro/packages/metro/src/DeltaBundler/Serializers/`

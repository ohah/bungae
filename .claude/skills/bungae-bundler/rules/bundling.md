# Bundling Process

3단계 번들링 파이프라인 구현 가이드.

```
Entry File → [Resolution] → [Transformation] → [Serialization] → Bundle
```

---

## 1. Resolution (모듈 해석)

모듈 import/require 경로를 실제 파일 경로로 해석.

### 지원 기능

| 기능 | 설명 | 예시 |
|------|------|------|
| 상대 경로 | `./`, `../` | `import './utils'` |
| npm 패키지 | node_modules 탐색 | `import 'lodash'` |
| 스코프 패키지 | @scope/package | `import '@react-native/core'` |
| 플랫폼별 확장자 | `.ios.js`, `.android.js` | `Button.ios.tsx` |
| Package exports | exports 필드 | `"exports": { ".": "./src" }` |
| react-native field | RN 전용 진입점 | `"react-native": "./native.js"` |

### 해석 우선순위

```typescript
// platform: 'ios' 일 때
const extensions = [
  '.ios.tsx', '.ios.ts', '.ios.jsx', '.ios.js',
  '.native.tsx', '.native.ts', '.native.jsx', '.native.js',
  '.tsx', '.ts', '.jsx', '.js',
  '.json',
];
```

### 참고 코드

- `reference/metro/packages/metro-resolver/src/resolve.js`

---

## 2. Transformation (코드 변환)

소스 코드를 RN 런타임이 실행 가능한 형태로 변환.

### 기본: Bun 내장 트랜스파일러

```typescript
const transpiler = new Bun.Transpiler({
  loader: 'tsx',
  target: 'browser',
});

const output = transpiler.transformSync(sourceCode);
```

### Babel 선택적 통합

`rules/transformer.md` 참조.

### 참고 코드

- `reference/metro/packages/metro-transform-worker/`

---

## 3. Serialization (번들 직렬화)

변환된 모듈들을 하나의 번들 파일로 합침.

### 번들 형식

| 형식 | 용도 | 특징 |
|------|------|------|
| Plain Bundle | 기본 | 모든 모듈을 하나의 JS 파일 |
| RAM Bundle (Indexed) | iOS | 바이너리 형식, 빠른 로딩 |
| RAM Bundle (File) | Android | 모듈별 파일 분리 |

### Plain Bundle 구조

```javascript
// 1. Polyfills
(function() { /* polyfill */ })();

// 2. Module definitions
__d(function(require, module, exports) {
  // module 0
}, 0, [1, 2]);

__d(function(require, module, exports) {
  // module 1
}, 1, []);

// 3. Entry execution
__r(0);
```

### 런타임 함수

```typescript
// __d: define module
function __d(factory, moduleId, dependencyIds) { ... }

// __r: require module (entry point)
function __r(moduleId) { ... }
```

### 참고 코드

- `reference/metro/packages/metro/src/DeltaBundler/Serializers/`

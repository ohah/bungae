# Babel → Bun 대체 가능성 분석

## 현재 graph-bundler/transformer.ts 파이프라인

```
소스 코드
    ↓
[1. 파싱 (Parsing)]
    ├── TypeScript (.ts, .tsx) → Babel parser + typescript plugin
    └── JavaScript/Flow (.js, .jsx) → hermes-parser
    ↓
[2. 변환 (Transformation)] - babel.transformFromAstAsync
    ├── babel.config.js 로드 (babelrc: true)
    ├── @react-native/babel-preset (프로젝트 설정)
    ├── babel-plugin-transform-define
    ├── @babel/plugin-transform-object-rest-spread
    ├── babel-plugin-minify-simplify (prod)
    └── babel-plugin-minify-dead-code-elimination (prod)
    ↓
[3. 결과]
    └── AST 반환 (코드 생성은 serializer에서)
```

---

## ✅ Bun으로 대체 가능한 부분

| 기능                                   | 현재 (Babel)                                | Bun 대체                       | 속도 개선     | 비고                          |
| -------------------------------------- | ------------------------------------------- | ------------------------------ | ------------- | ----------------------------- |
| **TypeScript 파싱**                    | `@babel/parser` + typescript plugin         | `Bun.Transpiler`               | **10-100x**   | 네이티브 Zig 구현             |
| **TypeScript 타입 제거**               | `@babel/preset-typescript`                  | `Bun.Transpiler`               | **10-100x**   |                               |
| **TSX 파싱**                           | `@babel/parser` + jsx + typescript          | `Bun.Transpiler`               | **10-100x**   |                               |
| **JSX 변환**                           | `@babel/preset-react`                       | `Bun.Transpiler`               | **10-100x**   | React.createElement로 변환    |
| **상수 치환 (`__DEV__`)**              | `babel-plugin-transform-define`             | `Bun.Transpiler` define        | **빠름**      | `define: { __DEV__: 'true' }` |
| **상수 치환 (`Platform.OS`)**          | `babel-plugin-transform-define`             | `Bun.Transpiler` define        | **빠름**      |                               |
| **상수 치환 (`process.env.NODE_ENV`)** | `babel-plugin-transform-define`             | `Bun.Transpiler` define        | **빠름**      |                               |
| **Import 스캔 (의존성 추출)**          | `@babel/traverse`                           | `Bun.Transpiler.scanImports()` | **매우 빠름** | 별도 AST 순회 불필요          |
| **Dead code elimination (기본)**       | `babel-plugin-minify-dead-code-elimination` | `Bun.Transpiler` (자동)        | **빠름**      | 상수 치환 후 자동 제거        |

---

## ❌ Bun으로 대체 불가능한 부분

| 기능                                 | 현재 (Babel)                                 | 대체 불가 이유         | 대안                     |
| ------------------------------------ | -------------------------------------------- | ---------------------- | ------------------------ |
| **Flow 파싱**                        | `hermes-parser`                              | Bun은 Flow 문법 미지원 | hermes-parser 유지       |
| **Flow 타입 제거**                   | `@babel/plugin-transform-flow-strip-types`   | Flow 미지원            | Babel 유지               |
| **ESM → CJS 변환**                   | `@babel/plugin-transform-modules-commonjs`   | Bun.Transpiler에 없음  | Babel 플러그인 사용      |
| **babel.config.js 로드**             | Babel 내장                                   | 프로젝트별 설정 필요   | Babel 유지               |
| **@react-native/babel-preset**       | Babel preset                                 | RN 특화 변환들 포함    | Babel 유지               |
| **커스텀 Babel 플러그인**            | 프로젝트별                                   | 플러그인 시스템 없음   | Babel 유지               |
| **react-native-codegen**             | Babel macro                                  | 코드 생성              | Babel 유지               |
| **Object rest spread (특수 케이스)** | `@babel/plugin-transform-object-rest-spread` | loose/useBuiltIns 옵션 | Babel 유지               |
| **minify-simplify**                  | `babel-plugin-minify-simplify`               | AST 레벨 최적화        | Babel 또는 별도 minifier |

---

## ⚠️ 부분적으로 대체 가능한 부분

| 기능                | 현재                 | Bun 가능 범위                     | 제한사항                       |
| ------------------- | -------------------- | --------------------------------- | ------------------------------ |
| **JavaScript 파싱** | hermes-parser        | Bun.Transpiler (Flow 없는 경우만) | Flow 구문 감지 필요            |
| **Minification**    | Babel minify plugins | Bun.Transpiler `minifyWhitespace` | 식별자 minify는 별도 도구 필요 |
| **Tree Shaking**    | 별도 구현            | Bun.Transpiler `treeShaking`      | 전체 번들 컨텍스트 필요시 제한 |

---

## 📊 파일 유형별 최적화 가능성

| 파일 유형          | 현재 처리                       | Bun 대체                       | 예상 개선 |
| ------------------ | ------------------------------- | ------------------------------ | --------- |
| `.ts`              | Babel parser → Babel transform  | **Bun.Transpiler** + Babel CJS | **높음**  |
| `.tsx`             | Babel parser → Babel transform  | **Bun.Transpiler** + Babel CJS | **높음**  |
| `.js` (Flow 없음)  | hermes-parser → Babel transform | **Bun.Transpiler** + Babel CJS | **중간**  |
| `.js` (Flow 있음)  | hermes-parser → Babel transform | ❌ 대체 불가                   | 없음      |
| `.jsx` (Flow 없음) | hermes-parser → Babel transform | **Bun.Transpiler** + Babel CJS | **중간**  |
| `.jsx` (Flow 있음) | hermes-parser → Babel transform | ❌ 대체 불가                   | 없음      |
| `.json`            | JSON.parse                      | 동일                           | 없음      |

---

## 🎯 권장 구현 전략

```
┌─────────────────────────────────────────────────────────────┐
│                     bun-bundler/transformer.ts              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  if (isTypeScript) {                                        │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ Bun.Transpiler (빠름)                               │  │
│    │ - TypeScript 파싱                                   │  │
│    │ - 타입 제거                                         │  │
│    │ - JSX 변환                                          │  │
│    │ - 상수 치환 (__DEV__, Platform.OS 등)              │  │
│    └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ Babel (필수, 느림)                                  │  │
│    │ - ESM → CJS 변환                                    │  │
│    │ - babel.config.js 플러그인 (필요시)                │  │
│    └─────────────────────────────────────────────────────┘  │
│                                                             │
│  } else if (hasFlowSyntax) {                               │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ 기존 Babel 파이프라인 유지                         │  │
│    │ - hermes-parser → Babel transform                  │  │
│    └─────────────────────────────────────────────────────┘  │
│                                                             │
│  } else {                                                   │
│    // JavaScript (Flow 없음) - Bun.Transpiler 사용 가능    │
│  }                                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📈 예상 성능 개선

| 시나리오                 | TypeScript 비율 | Flow 비율 | 예상 개선                 |
| ------------------------ | --------------- | --------- | ------------------------- |
| TypeScript 전용 프로젝트 | 100%            | 0%        | **50-70% 빌드 시간 감소** |
| 혼합 프로젝트            | 50%             | 50%       | **20-30% 빌드 시간 감소** |
| Flow 전용 프로젝트       | 0%              | 100%      | **개선 없음**             |
| RN + node_modules        | 10%             | 90%       | **5-10% 빌드 시간 감소**  |

> **참고**: React Native의 node_modules 대부분은 Flow를 사용하므로, 실제 개선은 프로젝트 코드(src/)에서 주로 발생합니다.

---

## 🔧 구현 예시 코드

```typescript
// bun-bundler/transformer.ts

const transpilerCache = new Map<string, Bun.Transpiler>();

function getTranspiler(
  loader: 'tsx' | 'ts' | 'jsx' | 'js',
  config: ResolvedConfig,
): Bun.Transpiler {
  const key = `${loader}-${config.platform}-${config.dev}`;
  let transpiler = transpilerCache.get(key);

  if (!transpiler) {
    transpiler = new Bun.Transpiler({
      loader,
      target: 'browser',
      define: {
        __DEV__: config.dev ? 'true' : 'false',
        'process.env.NODE_ENV': config.dev ? '"development"' : '"production"',
        'Platform.OS': `"${config.platform}"`,
      },
      treeShaking: false,
      trimUnusedImports: false,
    });
    transpilerCache.set(key, transpiler);
  }

  return transpiler;
}

function hasFlowSyntax(code: string): boolean {
  if (code.includes('@flow')) return true;

  const flowPatterns = [
    /:\s*\?\w+/, // Optional type: ?string
    /import\s+type\s*\{/, // import type { ... }
    /export\s+type\s*\{/, // export type { ... }
    /opaque\s+type/, // Opaque type
    /declare\s+module/, // Module declaration
    /declare\s+export/, // Export declaration
  ];

  return flowPatterns.some((pattern) => pattern.test(code));
}

export async function transformFile(filePath: string, code: string, config: ResolvedConfig) {
  const ext = extname(filePath).toLowerCase();
  const isTypeScript = ext === '.ts' || ext === '.tsx';

  // TypeScript: Bun.Transpiler + Babel ESM→CJS
  if (isTypeScript) {
    const isJSX = ext === '.tsx';
    const transpiler = getTranspiler(isJSX ? 'tsx' : 'ts', config);

    // Step 1: Bun.Transpiler (fast)
    const jsCode = transpiler.transformSync(code);

    // Step 2: Babel ESM → CJS (required for Metro)
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync(jsCode, { sourceType: 'module' });
    const result = await babel.transformFromAstAsync(ast, jsCode, {
      ast: true,
      code: false,
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    });

    return { ast: result.ast };
  }

  // Flow files: Use existing Babel pipeline
  if (hasFlowSyntax(code)) {
    return transformWithBabel(code, filePath, config);
  }

  // JavaScript (no Flow): Can use Bun.Transpiler
  const isJSX = ext === '.jsx';
  const transpiler = getTranspiler(isJSX ? 'jsx' : 'js', config);
  const jsCode = transpiler.transformSync(code);

  const babel = await import('@babel/core');
  const ast = await babel.parseAsync(jsCode, { sourceType: 'module' });
  const result = await babel.transformFromAstAsync(ast, jsCode, {
    ast: true,
    code: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  });

  return { ast: result.ast };
}
```

---

## 📚 참고 자료

- [Bun.Transpiler API](https://bun.sh/docs/api/transpiler)
- [Bun.build() format: 'cjs'](https://bun.sh/docs/bundler#format) (experimental)
- [@babel/plugin-transform-modules-commonjs](https://babeljs.io/docs/babel-plugin-transform-modules-commonjs)
- [hermes-parser](https://github.com/facebook/hermes/tree/main/tools/hermes-parser)

# Bun Bundler 트랜스파일 흐름

현재 `bun-bundler/transformer.ts`의 코드 변환 파이프라인입니다.

## 전체 흐름도

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              transformFile()                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────┐
                    │     파일 확장자 확인             │
                    └─────────────────────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
            ▼                         ▼                         ▼
     ┌──────────┐              ┌──────────┐              ┌──────────┐
     │  .json   │              │ .ts/.tsx │              │ .js/.jsx │
     └──────────┘              └──────────┘              └──────────┘
            │                         │                         │
            ▼                         │                         │
  ┌──────────────────┐                │                         │
  │ module.exports = │                │                         │
  │ JSON.parse()     │                │                         │
  └──────────────────┘                │                         │
            │                         │                         │
            │                         ▼                         ▼
            │              ┌─────────────────────────────────────────┐
            │              │         transformWithBabel()            │
            │              └─────────────────────────────────────────┘
            │                                   │
            ▼                                   ▼
      ┌──────────┐              ┌───────────────────────────────────┐
      │   AST    │              │      라이브러리 호출 순서          │
      └──────────┘              └───────────────────────────────────┘
```

---

## 파일 타입별 상세 흐름

### 1. TypeScript 파일 (.ts, .tsx)

```
┌─────────────┐
│  소스 코드   │
│  (TS/TSX)   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  1. @babel/core.parseAsync()                                │
│     - parserOpts.plugins: ['jsx', 'typescript']             │
│     - TypeScript 타입 + JSX 파싱                            │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  2. @babel/core.transformFromAstAsync()                     │
│     - babelrc: true (프로젝트 babel.config.js 사용)         │
│     - 플러그인:                                             │
│       • babel-plugin-transform-define (__DEV__, Platform.OS)│
│       • @babel/plugin-transform-object-rest-spread          │
│       • babel-plugin-minify-simplify (production only)      │
│       • babel-plugin-minify-dead-code-elimination (prod)    │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│  변환된 AST │
└─────────────┘
```

### 2. JavaScript/Flow 파일 (.js, .jsx) - 롤리팝 방식

```
┌─────────────┐
│  소스 코드   │
│  (JS/Flow)  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  1. flow-remove-types()                                     │
│     - all: true (모든 Flow 타입 제거)                       │
│     - removeEmptyImports: true (import type {} 제거)        │
│     - Babel보다 빠른 토큰 레벨 처리                         │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  2. hermes-parser.parse()                                   │
│     - flow: 'all', babel: true (Babel 호환 AST 출력)        │
│     - React Native 공식 파서                                │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  3. @babel/generator()                                      │
│     - AST에서 깔끔한 JavaScript 코드 생성                   │
│     - sourceMaps: true (소스맵 생성)                        │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  4. @babel/core.parseAsync()                                │
│     - 생성된 코드를 다시 AST로 파싱                         │
│     - parserOpts.plugins: ['jsx']                           │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  5. @babel/core.transformFromAstAsync()                     │
│     - babelrc: true (프로젝트 babel.config.js 사용)         │
│     - 플러그인:                                             │
│       • babel-plugin-transform-define (__DEV__, Platform.OS)│
│       • @babel/plugin-transform-object-rest-spread          │
│       • babel-plugin-minify-simplify (production only)      │
│       • babel-plugin-minify-dead-code-elimination (prod)    │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│  변환된 AST │
└─────────────┘
```

### 3. JSON 파일 (.json)

```
┌─────────────┐
│  JSON 내용  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  @babel/core.parseAsync()                                   │
│     - 코드: `module.exports = ${jsonContent};`              │
│     - CommonJS 모듈로 래핑                                  │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│     AST     │
└─────────────┘
```

---

## 라이브러리 역할 요약

| 라이브러리                                   | 역할                                    | 적용 대상                   |
| -------------------------------------------- | --------------------------------------- | --------------------------- |
| `flow-remove-types`                          | Flow 타입 문법 제거 (토큰 레벨, 빠름)   | .js, .jsx                   |
| `hermes-parser`                              | JavaScript AST 파싱 (React Native 공식) | .js, .jsx                   |
| `@babel/generator`                           | AST → JavaScript 코드 생성              | .js, .jsx                   |
| `@babel/core`                                | TypeScript 파싱 + 코드 변환             | .ts, .tsx, .js, .jsx, .json |
| `babel-plugin-transform-define`              | 상수 치환 (**DEV**, Platform.OS)        | 모든 JS/TS                  |
| `@babel/plugin-transform-object-rest-spread` | spread 연산자 변환                      | 모든 JS/TS                  |
| `babel-plugin-minify-*`                      | 코드 최소화 (production)                | 모든 JS/TS                  |

---

## Babel Config 설정

```typescript
const babelConfig = {
  ast: true, // AST 출력
  babelrc: true, // 프로젝트 babel.config.js 사용
  caller: {
    bundler: 'metro', // Metro 호환 caller
    name: 'metro',
    platform: 'ios' | 'android',
  },
  cloneInputAst: false, // 성능 최적화
  code: false, // 코드 출력 안 함 (AST만 필요)
  cwd: projectRoot,
  filename: filePath,
  highlightCode: true,
  sourceType: 'module',
};
```

---

## 향후 최적화 계획

현재 파이프라인에서 Babel의 의존도가 높습니다. 향후 다음과 같은 최적화를 검토할 수 있습니다:

| 현재                  | 향후 대안        | 기대 효과      |
| --------------------- | ---------------- | -------------- |
| Babel (TS 파싱)       | SWC              | 파싱 속도 향상 |
| Babel (코드 변환)     | SWC transform    | 변환 속도 향상 |
| Babel minify 플러그인 | Terser / esbuild | 압축 속도 향상 |

단, Metro 호환성을 유지하면서 점진적으로 교체해야 합니다.

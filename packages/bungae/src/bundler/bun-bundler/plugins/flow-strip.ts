/**
 * Bun Plugin: Flow type stripping
 *
 * Flow 구문이 있는 .js/.jsx 파일을 감지하여 타입을 제거합니다.
 * Hermes Parser + Babel을 사용하여 React 19 component 키워드도 지원합니다.
 */

import type { BunPlugin } from 'bun';

// Babel 캐싱
let cachedBabel: typeof import('@babel/core') | null = null;

async function getBabel() {
  if (!cachedBabel) {
    cachedBabel = await import('@babel/core');
  }
  return cachedBabel;
}

/**
 * Flow 구문이 있는지 빠르게 감지
 */
function hasFlowSyntax(code: string): boolean {
  // @flow 주석 체크 (가장 확실한 방법)
  if (/@flow\b/.test(code)) {
    return true;
  }

  // Flow 타입 어노테이션 패턴 감지
  // 1. 함수 파라미터 타입: (param: Type)
  // 2. 변수 타입: const x: Type =
  // 3. 함수 리턴 타입: ): Type {
  // 4. 제네릭: <T> 또는 Type<T>
  // 5. type/interface 선언

  // type 또는 interface 선언
  if (/^\s*(export\s+)?(type|interface)\s+\w+/m.test(code)) {
    return true;
  }

  // 타입 어노테이션 (: Type)
  // Flow/TypeScript 구문: param: string, ): void, const x: number
  if (/:\s*(string|number|boolean|any|mixed|void|null|Object|Array|Function)\b/.test(code)) {
    return true;
  }

  return false;
}

/**
 * Flow 타입을 제거하고 JSX를 변환하여 순수 JavaScript로 변환
 */
async function stripFlowTypes(code: string, filePath: string, dev: boolean): Promise<string> {
  const babel = await getBabel();
  const isJSX = filePath.endsWith('.jsx') || filePath.endsWith('.js');

  const plugins: any[] = [
    // Hermes Parser로 Flow 구문 파싱 (React 19 component 키워드 지원)
    [
      require.resolve('babel-plugin-syntax-hermes-parser'),
      {
        parseLangTypes: 'flow',
        reactRuntimeTarget: '19',
      },
    ],
    // Flow 타입 제거
    require.resolve('@babel/plugin-transform-flow-strip-types'),
  ];

  // JSX 변환 추가 (Bun.build에서 처리하기 전에 변환)
  if (isJSX) {
    plugins.push([require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }]);
  }

  const result = await babel.transformAsync(code, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    plugins,
    // 개발 모드에서만 소스맵 생성
    sourceMaps: dev ? 'inline' : false,
  });

  return result?.code || code;
}

/**
 * Private fields와 class properties를 Hermes 호환 코드로 변환
 */
async function transformPrivateFields(code: string, filePath: string): Promise<string> {
  // Private fields가 없으면 변환 불필요
  if (!code.includes('#')) {
    return code;
  }

  const babel = await getBabel();

  const result = await babel.transformAsync(code, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    plugins: [
      // Private methods/fields → WeakMap 기반 코드로 변환
      [require.resolve('@babel/plugin-transform-private-methods'), { loose: true }],
      [require.resolve('@babel/plugin-transform-class-properties'), { loose: true }],
      [require.resolve('@babel/plugin-transform-private-property-in-object'), { loose: true }],
    ],
    sourceMaps: false,
  });

  return result?.code || code;
}

export interface FlowStripPluginOptions {
  dev?: boolean;
  /** 특정 경로 패턴 제외 (예: node_modules) */
  exclude?: RegExp[];
  /** Flow 파일만 처리 (기본: true) */
  flowOnly?: boolean;
}

/**
 * Flow 타입 제거 Bun 플러그인
 */
export function flowStripPlugin(options: FlowStripPluginOptions = {}): BunPlugin {
  const { dev = true, exclude = [], flowOnly = true } = options;

  return {
    name: 'flow-strip',
    setup(build) {
      // .js, .jsx 파일 처리 (TypeScript는 Bun이 자체 처리)
      build.onLoad({ filter: /\.(js|jsx)$/ }, async (args) => {
        // 제외 패턴 체크
        for (const pattern of exclude) {
          if (pattern.test(args.path)) {
            return undefined; // Bun 기본 처리
          }
        }

        const code = await Bun.file(args.path).text();

        // Flow 구문이 없으면 Bun 기본 처리
        if (flowOnly && !hasFlowSyntax(code)) {
          return undefined;
        }

        try {
          const stripped = await stripFlowTypes(code, args.path, dev);

          // JSX가 이미 변환되었으므로 loader는 항상 'js'
          return {
            contents: stripped,
            loader: 'js',
          };
        } catch (error) {
          // 변환 실패 시 원본 반환 (Bun이 에러 처리)
          console.warn(`Flow strip failed for ${args.path}:`, error);
          return undefined;
        }
      });
    },
  };
}

/**
 * Hermes 호환성 플러그인 (node_modules 포함 모든 JS 파일)
 *
 * Private fields (#field)를 Hermes가 지원하는 코드로 변환합니다.
 */
export function hermesCompatPlugin(): BunPlugin {
  return {
    name: 'hermes-compat',
    setup(build) {
      // 모든 .js 파일에서 private fields 변환
      build.onLoad({ filter: /\.js$/ }, async (args) => {
        const code = await Bun.file(args.path).text();

        // Private fields가 없으면 건너뛰기
        if (!code.includes('#')) {
          return undefined;
        }

        try {
          const transformed = await transformPrivateFields(code, args.path);
          return {
            contents: transformed,
            loader: 'js',
          };
        } catch (error) {
          console.warn(`Hermes compat transform failed for ${args.path}:`, error);
          return undefined;
        }
      });
    },
  };
}

export { hasFlowSyntax, stripFlowTypes, transformPrivateFields };

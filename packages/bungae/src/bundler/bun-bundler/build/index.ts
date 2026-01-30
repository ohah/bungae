/**
 * Bun.build based bundler with Scope Hoisting
 *
 * Flow 선처리 후 Bun.build로 번들링하여 자동으로 Scope Hoisting을 적용합니다.
 * Metro의 __d() 래퍼 대신 ESM + Scope Hoisting 방식을 사용합니다.
 *
 * 장점:
 * - ES6 class 호이스팅 문제 없음 (scope hoisting으로 코드 순서 보장)
 * - 더 작은 번들 크기 (래퍼 오버헤드 없음)
 * - 더 나은 tree shaking
 * - Bun의 빠른 번들링 속도
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

import { transformSync as swcTransformSync } from '@swc/core';
import type { BunPlugin, BuildOutput } from 'bun';
import type { HelperMode } from 'oxc-transform';
import { transformSync } from 'oxc-transform';

import type { ResolvedConfig } from '../../../config/types';

/**
 * OXC 런타임 헬퍼 (babelHelpers 전역 객체)
 * OXC의 External 모드에서 사용되는 헬퍼 함수들
 */
const BABEL_HELPERS = `
// OXC/Babel Runtime Helpers
var babelHelpers = {};

// Private field helpers (OXC/Babel external mode)
babelHelpers.classPrivateFieldInitSpec = function(obj, privateMap, value) {
  if (privateMap != null && typeof privateMap.set === "function") privateMap.set(obj, value);
};
babelHelpers.classPrivateFieldGet2 = function(privateMap, receiver) {
  return privateMap != null && typeof privateMap.get === "function" ? privateMap.get(receiver) : undefined;
};
babelHelpers.classPrivateFieldSet2 = function(privateMap, receiver, value) {
  if (privateMap != null && typeof privateMap.set === "function") privateMap.set(receiver, value);
  return value;
};
babelHelpers.classPrivateMethodInitSpec = function(obj, privateSet) {
  if (privateSet != null && typeof privateSet.add === "function") privateSet.add(obj);
};
babelHelpers.assertClassBrand = function(brandOrPrivateSet, receiver, accessKind) {
  if (typeof brandOrPrivateSet === "function" ? brandOrPrivateSet === receiver : (brandOrPrivateSet != null && typeof brandOrPrivateSet.has === "function" && brandOrPrivateSet.has(receiver))) return;
  throw new TypeError("Cannot " + accessKind + " private member");
};
// Globals used by some OXC/Babel output for private fields (Hermes compat)
function _check_private_redeclaration(obj, privateCollection) {
  if (privateCollection != null && typeof privateCollection.has === "function" && privateCollection.has(obj)) {
    throw new TypeError("Cannot initialize the same private elements twice on an object");
  }
}
function _class_private_field_init(obj, privateCollection, value) {
  _check_private_redeclaration(obj, privateCollection);
  if (privateCollection != null && typeof privateCollection.add === "function") {
    privateCollection.add(obj);
  }
  if (privateCollection != null && typeof privateCollection.set === "function") {
    privateCollection.set(obj, value);
  }
}
if (typeof globalThis !== "undefined") {
  globalThis._check_private_redeclaration = _check_private_redeclaration;
  globalThis._class_private_field_init = _class_private_field_init;
}

// Object helpers
babelHelpers.objectSpread2 = function(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};
    var keys = Object.keys(source);
    if (typeof Object.getOwnPropertySymbols === "function") {
      keys = keys.concat(Object.getOwnPropertySymbols(source).filter(function(sym) {
        return Object.getOwnPropertyDescriptor(source, sym).enumerable;
      }));
    }
    keys.forEach(function(key) {
      Object.defineProperty(target, key, {
        value: source[key],
        enumerable: true,
        configurable: true,
        writable: true
      });
    });
  }
  return target;
};
babelHelpers.objectWithoutProperties = function(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;
  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }
  return target;
};
babelHelpers.objectDestructuringEmpty = function(obj) {
  if (obj == null) throw new TypeError("Cannot destructure " + obj);
};
babelHelpers.extends = Object.assign || function(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i];
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = source[key];
      }
    }
  }
  return target;
};

// Async helpers
babelHelpers.asyncToGenerator = function(fn) {
  return function() {
    var self = this, args = arguments;
    return new Promise(function(resolve, reject) {
      var gen = fn.apply(self, args);
      function step(key, arg) {
        try {
          var info = gen[key](arg);
          var value = info.value;
        } catch (error) {
          reject(error);
          return;
        }
        if (info.done) {
          resolve(value);
        } else {
          Promise.resolve(value).then(function(value) { step("next", value); }, function(err) { step("throw", err); });
        }
      }
      step("next");
    });
  };
};
`;
import { flowStripPlugin } from '../plugins/flow-strip';
import { platformResolverPlugin } from '../plugins/platform-resolver';
import type { BuildResult } from '../types';

/**
 * Build options (Metro-compatible interface)
 */
export interface BuildOptions {
  /** Exclude source code from source map (Metro-compatible) */
  excludeSource?: boolean;
  /** Return modules only, skip prelude and runtime (Metro-compatible) */
  modulesOnly?: boolean;
  /** Run module after loading (Metro-compatible) */
  runModule?: boolean;
  /** Source paths mode: 'absolute' or 'url-server' (Metro-compatible) */
  sourcePaths?: 'absolute' | 'url-server';
  /** Source URL for bundle (Metro-compatible: passed to getAppendScripts) */
  sourceUrl?: string;
  /** Source map URL for bundle (Metro-compatible: passed to getAppendScripts) */
  sourceMapUrl?: string;
}

/**
 * React Native 프리루드 (전역 변수 및 폴리필)
 */
function getPrelude(config: ResolvedConfig): string {
  const { dev, platform } = config;

  return `// Bungae Bundle - Scope Hoisting Mode
var __BUNDLE_START_TIME__ = Date.now();
var __DEV__ = ${dev};
// Provide Node-like / browser-like global aliases (React Native has neither window nor global)
var global = globalThis;
global.global = global;
var window = globalThis;
globalThis.window = window;
// performance.now() polyfill (React Native may provide nativePerformanceNow)
var performance = globalThis.performance || {
  now: function() { return typeof globalThis.nativePerformanceNow === 'function' ? globalThis.nativePerformanceNow() : Date.now(); }
};
globalThis.performance = performance;
${BABEL_HELPERS}

// React Native globals
var Platform = { OS: '${platform}', Version: 0, select: function(o) { return o['${platform}'] || o.default; } };

// Console polyfill
if (typeof console === 'undefined') {
  var console = { log: function() {}, warn: function() {}, error: function() {}, info: function() {}, debug: function() {} };
}

// ErrorUtils for React Native
var ErrorUtils = globalThis.ErrorUtils || {
  setGlobalHandler: function(handler) { this._globalHandler = handler; },
  getGlobalHandler: function() { return this._globalHandler || null; },
  reportFatalError: function(e) { 
    if (this._globalHandler) this._globalHandler(e, true);
    else throw e; 
  },
  reportError: function(e) { 
    if (this._globalHandler) this._globalHandler(e, false);
    else console.error(e); 
  }
};
globalThis.ErrorUtils = ErrorUtils;

// Callable 모듈 가라 객체 (dev만) - 네이티브가 호출하는 메서드만 no-op
${
  dev
    ? `
var HMRClient = {
  setup: function() { try {} catch (e) {} },
  enable: function() { try {} catch (e) {} },
  disable: function() { try {} catch (e) {} },
  registerBundle: function() { try {} catch (e) {} },
  log: function(level, data) { try { if (typeof console !== 'undefined' && console[level]) console[level].apply(console, ['[HMR]'].concat(data || [])); } catch (e) {} }
};
var RCTDeviceEventEmitter = {
  emit: function() { try {} catch (e) {} },
  addListener: function() { return { remove: function() {} }; },
  removeAllListeners: function() { try {} catch (e) {} },
  listenerCount: function() { return 0; }
};
var RCTNativeAppEventEmitter = RCTDeviceEventEmitter;
var RCTEventEmitter = { register: function() { try {} catch (e) {} } };
globalThis.HMRClient = HMRClient;
globalThis.RCTDeviceEventEmitter = RCTDeviceEventEmitter;
globalThis.RCTNativeAppEventEmitter = RCTNativeAppEventEmitter;
globalThis.RCTEventEmitter = RCTEventEmitter;
if (typeof global !== 'undefined') {
  global.HMRClient = HMRClient;
  global.RCTDeviceEventEmitter = RCTDeviceEventEmitter;
  global.RCTNativeAppEventEmitter = RCTNativeAppEventEmitter;
  global.RCTEventEmitter = RCTEventEmitter;
}
if (typeof global !== 'undefined' && typeof global.RN$registerCallableModule === 'function') {
  try {
    global.RN$registerCallableModule('HMRClient', function() { return HMRClient; });
    global.RN$registerCallableModule('RCTDeviceEventEmitter', function() { return RCTDeviceEventEmitter; });
    global.RN$registerCallableModule('RCTNativeAppEventEmitter', function() { return RCTNativeAppEventEmitter; });
    global.RN$registerCallableModule('RCTEventEmitter', RCTEventEmitter);
  } catch (e) {}
}
(function __regCallables(n) {
  if (n > 100) return;
  var g = typeof global !== 'undefined' ? global : globalThis;
  if (g && g.__fbBatchedBridge && typeof g.__fbBatchedBridge.registerCallableModule === 'function') {
    try {
      if (g.HMRClient) g.__fbBatchedBridge.registerCallableModule('HMRClient', g.HMRClient);
      if (g.RCTDeviceEventEmitter) g.__fbBatchedBridge.registerCallableModule('RCTDeviceEventEmitter', g.RCTDeviceEventEmitter);
      if (g.RCTNativeAppEventEmitter) g.__fbBatchedBridge.registerCallableModule('RCTNativeAppEventEmitter', g.RCTNativeAppEventEmitter);
      if (g.RCTEventEmitter) g.__fbBatchedBridge.registerCallableModule('RCTEventEmitter', g.RCTEventEmitter);
    } catch (e) {}
    return;
  }
  if (typeof queueMicrotask === 'function') queueMicrotask(function() { __regCallables(n + 1); });
  else setTimeout(function() { __regCallables(n + 1); }, 0);
})(0);
`
    : ''
}
`;
}

/**
 * IIFE 시작 직후에 callable 모듈 등록 시도 코드 주입.
 * __fbBatchedBridge가 생성되자마자 microtask로 등록되도록 함.
 */
function injectHMRClientRegistrationAtIIFEStart(bundleCode: string): string {
  const inject =
    "(function __bungeeReg(){var g=typeof global!=='undefined'?global:globalThis;if(g&&g.__fbBatchedBridge&&typeof g.__fbBatchedBridge.registerCallableModule==='function'){try{if(g.HMRClient)g.__fbBatchedBridge.registerCallableModule('HMRClient',g.HMRClient);if(g.RCTDeviceEventEmitter)g.__fbBatchedBridge.registerCallableModule('RCTDeviceEventEmitter',g.RCTDeviceEventEmitter);if(g.RCTNativeAppEventEmitter)g.__fbBatchedBridge.registerCallableModule('RCTNativeAppEventEmitter',g.RCTNativeAppEventEmitter);if(g.RCTEventEmitter)g.__fbBatchedBridge.registerCallableModule('RCTEventEmitter',g.RCTEventEmitter);}catch(e){}}else{if(typeof queueMicrotask==='function')queueMicrotask(__bungeeReg);else setTimeout(__bungeeReg,0);}})();";
  const iifeStart = /^(\s*\(\s*\)\s*=>\s*\{)/;
  const match = bundleCode.match(iifeStart);
  if (match) {
    return bundleCode.replace(iifeStart, match[1] + inject);
  }
  const iifeStartFn = /^(\s*\(\s*function\s*\(\s*\)\s*\{)/;
  const matchFn = bundleCode.match(iifeStartFn);
  if (matchFn) {
    return bundleCode.replace(iifeStartFn, matchFn[1] + inject);
  }
  return bundleCode;
}

/**
 * React Native 에필로그
 */
function getEpilogue(config: ResolvedConfig, options: BuildOptions): string {
  const { sourceUrl, sourceMapUrl } = options;

  let epilogue = '';

  // Source URL comment (for debugger)
  if (sourceUrl) {
    epilogue += `\n//# sourceURL=${sourceUrl}`;
  }

  // Source map URL comment
  if (sourceMapUrl && !config.serializer?.inlineSourceMap) {
    epilogue += `\n//# sourceMappingURL=${sourceMapUrl}`;
  }

  // Classic bridge: callable 모듈 BatchedBridge 등록 (번들 실행 후 __fbBatchedBridge 존재)
  if (config.dev) {
    epilogue += `
try {
  var __g = typeof global !== 'undefined' ? global : globalThis;
  if (__g && __g.__fbBatchedBridge && typeof __g.__fbBatchedBridge.registerCallableModule === 'function') {
    if (__g.HMRClient) __g.__fbBatchedBridge.registerCallableModule('HMRClient', __g.HMRClient);
    if (__g.RCTDeviceEventEmitter) __g.__fbBatchedBridge.registerCallableModule('RCTDeviceEventEmitter', __g.RCTDeviceEventEmitter);
    if (__g.RCTNativeAppEventEmitter) __g.__fbBatchedBridge.registerCallableModule('RCTNativeAppEventEmitter', __g.RCTNativeAppEventEmitter);
    if (__g.RCTEventEmitter) __g.__fbBatchedBridge.registerCallableModule('RCTEventEmitter', __g.RCTEventEmitter);
  }
} catch (e) {}
`;
  }

  // Bundle load time logging (dev only)
  if (config.dev) {
    epilogue += `
// Bundle loaded
if (typeof __BUNDLE_START_TIME__ !== 'undefined') {
  console.log('[Bungae] Bundle loaded in ' + (Date.now() - __BUNDLE_START_TIME__) + 'ms (Scope Hoisting)');
}
`;
  }

  return epilogue;
}

/**
 * Bun.build로 번들 생성 (Scope Hoisting 자동 적용)
 */
export async function buildWithGraph(
  config: ResolvedConfig,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
  options?: BuildOptions,
): Promise<BuildResult> {
  const { entry, dev, root } = config;

  const entryPath = resolve(root, entry);
  if (!existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  const startTime = Date.now();

  // Progress callback - Bun.build doesn't provide granular progress,
  // so we simulate it
  onProgress?.(0, 1);

  console.log(`\r\x1b[K info Building with Bun.build (Scope Hoisting)...`);

  // 플러그인 설정
  const plugins: BunPlugin[] = [
    // 1. 플랫폼별 모듈 해석
    platformResolverPlugin({
      platform: config.platform as 'ios' | 'android',
      root: config.root,
      nodeModulesPaths: config.resolver.nodeModulesPaths,
    }),
    // 2. Flow 타입 제거 (Flow 파일만 Babel로 처리)
    flowStripPlugin({
      dev: config.dev,
      flowOnly: true,
    }),
    // Note: OXC Transform은 Bun.build 후 후처리로 적용
    // Bun 플러그인 내에서 OXC 호출 시 크래시 발생 (Bun 버그)
  ];

  // Bun.build 실행
  let result: BuildOutput;
  try {
    result = await Bun.build({
      entrypoints: [entryPath],
      target: 'browser', // Hermes는 browser 타겟과 호환
      format: 'iife', // IIFE로 출력 (Hermes 스크립트 호환, Scope Hoisting 유지)
      minify: config.minify && !dev,
      sourcemap: dev ? 'inline' : 'none',
      splitting: false, // 단일 번들
      plugins,

      // 컴파일 타임 상수 정의
      define: {
        __DEV__: String(dev),
        'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
        'globalThis.__DEV__': String(dev),
      },

      // 외부 모듈 없음 (모두 번들링)
      external: [],

      // 출력 설정
      naming: '[name].[ext]',
    });
  } catch (error) {
    console.error('Bun.build failed:', error);
    throw error;
  }

  if (!result.success) {
    const errors = result.logs
      .filter((log) => log.level === 'error')
      .map((log) => `${log.message}`)
      .join('\n');
    throw new Error(`Bun.build failed:\n${errors}`);
  }

  // 번들 코드 추출
  const output = result.outputs[0];
  if (!output) {
    throw new Error('Bun.build produced no output');
  }

  let bundleCode = await output.text();

  // 모듈 수 추정 (export/import 패턴 기반)
  const moduleCount = Math.max(1, (bundleCode.match(/\/\/ /g) || []).length);

  const bunBuildTime = Date.now() - startTime;
  console.log(`\r\x1b[K info Bun.build done in ${bunBuildTime}ms (${moduleCount} modules)`);

  // OXC Transform: ES2015로 변환 (private fields, class properties 등)
  // Bun.build 플러그인 내에서 호출하면 크래시가 발생하므로 후처리로 수행
  console.log(`\r\x1b[K info Transforming to ES2015 with OXC...`);
  const oxcStartTime = Date.now();

  try {
    const oxcResult = transformSync('bundle.js', bundleCode, {
      target: ['es2015'],
      assumptions: {
        setPublicClassFields: true,
      },
      helpers: {
        mode: 'External' as HelperMode, // Rust HelperLoaderMode::External (PascalCase)
      },
    });

    if (oxcResult.errors && oxcResult.errors.length > 0) {
      const errors = oxcResult.errors.filter((e) => e.severity === 'Error');
      if (errors.length > 0) {
        console.warn('OXC transform errors:', errors);
      }
    }

    bundleCode = oxcResult.code;
    console.log(`\r\x1b[K info OXC transform done in ${Date.now() - oxcStartTime}ms`);
  } catch (error) {
    console.error('OXC transform failed:', error);
    // OXC 실패 시 원본 코드 유지 (private fields 에러가 발생할 수 있음)
  }

  // Hermes compat: SWC 인라인 헬퍼가 undefined인 privateCollection으로 호출될 수 있음.
  // privateCollection.has(obj) 호출 전에 방어 코드 삽입 (privateCollection.has is not a function 방지)
  bundleCode = bundleCode.replace(
    /privateCollection\.has\s*\(\s*([^)]+)\s*\)/g,
    '(privateCollection != null && typeof privateCollection.has === "function" ? privateCollection.has($1) : false)',
  );

  // Hermes(현재 ExampleApp 환경)는 class 문법 파싱에 실패할 수 있음.
  // OXC는 최저 target이 es2015라 class를 ES5로 내릴 수 없으므로, 최종 번들을 SWC로 ES5로 downlevel.
  console.log(`\r\x1b[K info Downleveling to ES5 with SWC...`);
  const swcStartTime = Date.now();
  try {
    const swcResult = swcTransformSync(bundleCode, {
      filename: 'bundle.js',
      sourceMaps: false,
      module: {
        type: 'es6',
      },
      jsc: {
        target: 'es5',
        externalHelpers: false,
        parser: {
          syntax: 'ecmascript',
        },
      },
    });
    bundleCode = swcResult.code;
    console.log(`\r\x1b[K info SWC downlevel done in ${Date.now() - swcStartTime}ms`);
  } catch (error) {
    console.error('SWC downlevel failed:', error);
    // 실패 시 원본 유지 (Hermes에서 class 파싱 에러가 날 수 있음)
  }

  // Progress 완료
  onProgress?.(moduleCount, moduleCount);

  const totalBuildTime = Date.now() - startTime;
  console.log(
    `\r\x1b[K info Total build done in ${totalBuildTime}ms (${moduleCount} modules, Scope Hoisting + OXC)`,
  );

  // dev일 때 IIFE 시작 직후에 HMRClient 등록 시도 주입 (__fbBatchedBridge 생성 직후 등록되도록)
  if (config.dev && bundleCode) {
    bundleCode = injectHMRClientRegistrationAtIIFEStart(bundleCode);
  }

  // 프리루드 + 번들 + 에필로그 조합
  const prelude = getPrelude(config);
  const epilogue = getEpilogue(config, options || {});

  let finalCode = `${prelude}\n${bundleCode}\n${epilogue}`;

  // 소스맵 처리
  let map: string | undefined;
  if (dev && config.serializer?.inlineSourceMap) {
    // Inline source map은 이미 bundleCode에 포함되어 있음
    // Bun.build의 sourcemap: 'inline' 옵션 사용
  } else if (dev) {
    // External source map
    const mapOutput = result.outputs.find((o) => o.path.endsWith('.map'));
    if (mapOutput) {
      map = await mapOutput.text();
    }
  }

  // BuildResult 반환 (Metro-compatible interface)
  // Note: Scope Hoisting 방식에서는 graph와 createModuleId가 없음
  return {
    code: finalCode,
    map,
    assets: [], // TODO: Asset 추출 구현
    // graph와 createModuleId는 HMR에 필요하지만 scope hoisting에서는 다른 방식 필요
  };
}

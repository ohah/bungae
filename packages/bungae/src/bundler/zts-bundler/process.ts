/**
 * ZTS subprocess management
 *
 * Spawns and manages the zts binary process.
 * Parses NDJSON events from --watch-json stdout.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

import type { ResolvedConfig } from '../../config/types';
import { VERSION } from '../../index';
import { logWarn } from '../graph-bundler/utils';
import { tryResolve, resolveRnPolyfills, RN_GLOBAL_IDENTIFIERS } from './rn-constants';

/** NDJSON event from zts --watch-json */
export interface ZtsReadyEvent {
  type: 'ready';
  files: number;
}

export interface ZtsRebuildEvent {
  type: 'rebuild';
  success: boolean;
  changed?: string[];
  updates?: Array<{ id: string; code: string }>; // --dev mode: per-module HMR codes
  graph_changed?: boolean; // --dev mode: new imports added, full reload needed
  modules?: string[];
  bytes?: number;
  error?: string;
}

export type ZtsEvent = ZtsReadyEvent | ZtsRebuildEvent;

/**
 * Find the zts binary path.
 * Looks for pre-built binary in the zts submodule.
 */
function findZtsBinary(projectRoot: string): string {
  // Check zts in workspace — bungae와 zts가 같은 워크스페이스에 있다고 가정
  const candidates = [
    join(projectRoot, 'zts/zig-out/bin/zts'),
    join(projectRoot, '../zts/zig-out/bin/zts'),
    resolve(projectRoot, '../../zts/zig-out/bin/zts'),
    // bungae와 zts가 sibling 디렉토리일 때 (workspace/bungae, workspace/zts)
    resolve(projectRoot, '../../../zts/zig-out/bin/zts'),
  ];

  // Also check relative to this file's location (bungae repo)
  const bungaeRoot = resolve(__dirname, '../../../../..');
  candidates.push(join(bungaeRoot, 'zts/zig-out/bin/zts'));
  candidates.push(join(bungaeRoot, '../zts/zig-out/bin/zts'));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `zts binary not found. Build it with: cd zts && zig build -Doptimize=ReleaseFast\n` +
      `Searched paths:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
  );
}

/**
 * Build CLI arguments for zts subprocess
 */
function buildZtsArgs(config: ResolvedConfig, outputPath: string, watchMode: boolean): string[] {
  const args: string[] = ['--bundle', resolve(config.root, config.entry)];

  // Output
  args.push('-o', outputPath);

  // Platform
  const platform = config.platform === 'web' ? 'browser' : 'react-native';
  args.push(`--platform=${platform}`);

  // Sourcemap
  if (config.sourceMap || config.dev) {
    args.push('--sourcemap');
  }

  // Minify
  if (config.minify) {
    args.push('--minify');
  }

  // Target: Hermes requires ES5 for React Native
  if (platform === 'react-native') {
    args.push('--target=es5');
    // 롤다운 호환: global → __BUNGAE_GLOBAL__로 치환 (global 자체는 보존).
    // Metro/Hermes가 네이티브로 제공하는 global 객체를 덮어쓰지 않도록.
    args.push('--define:global=__BUNGAE_GLOBAL__');
    // RN platform-specific extensions (.ios.js, .android.js)
    const rnPlatform =
      config.platform === 'ios' ? 'ios' : config.platform === 'android' ? 'android' : 'ios';
    args.push(`--rn-platform=${rnPlatform}`);

    // JSX 런타임: 롤리팝과 동일하게 automatic 사용.
    // dev → jsxDEV (소스 위치 포함), prod → jsx/jsxs
    if (config.dev) {
      args.push('--jsx-dev');

      // ZTS dev mode: __zts_register() 래핑 + HMR 런타임 주입 + React Refresh
      args.push('--dev');

      // HMRClient.js 교체는 asset-plugin의 onLoad hook으로 처리

      // RCTJavaScriptDidLoadNotification이 발생하지 않아 DevLoadingView가
      // 자동으로 사라지지 않는 문제 해결. Bridge NativeModules로 직접 hide 호출.
      const hideLoadingView =
        'setTimeout(function(){try{NativeModules.DevLoadingView.hide()}catch(e){}},0);';
      args.push('--footer:js=' + hideLoadingView);
    }

    // RN prelude (Metro prelude equivalent) — 폴리필보다 먼저 실행되는 글로벌 변수 정의
    const prelude = [
      `var __BUNDLE_START_TIME__=this.nativePerformanceNow?nativePerformanceNow():Date.now();`,
      `var __DEV__=${config.dev};`,
      // __BUNGAE_GLOBAL__: 모듈 코드의 global 참조를 치환한 대상 (--define:global=__BUNGAE_GLOBAL__)
      `var __BUNGAE_GLOBAL__=typeof globalThis!=='undefined'?globalThis:typeof global!=='undefined'?global:typeof window!=='undefined'?window:this;`,
      // global: 폴리필/InitializeCore가 직접 참조하는 네이티브 글로벌 (Hermes가 미제공 시 폴백)
      `if(typeof global==='undefined')var global=__BUNGAE_GLOBAL__;`,
      `var process=__BUNGAE_GLOBAL__.process||{};process.env=process.env||{};process.env.NODE_ENV=process.env.NODE_ENV||"${config.dev ? 'development' : 'production'}";`,
      // Bungae bundler identifier — App.tsx에서 번들러 감지용
      `globalThis.__BUNGAE_BUNDLER__=true;globalThis.__BUNGAE_VERSION__=${JSON.stringify(VERSION)};`,
    ].join('');
    args.push(`--banner:js=${prelude}`);

    // define으로 모듈 코드의 __DEV__, process.env.NODE_ENV 컴파일 타임 치환
    // (banner는 런타임, define은 컴파일 타임 — ZTS 자동 define "production" 오버라이드)
    args.push(`--define:__DEV__=${config.dev}`);
    args.push(`--define:process.env.NODE_ENV="${config.dev ? 'development' : 'production'}"`);

    // Polyfills: console.js, error-guard.js — IIFE로 감싸서 번들 시작 시 즉시 실행
    for (const polyfillPath of resolveRnPolyfills(config.root)) {
      args.push(`--polyfill=${polyfillPath}`);
    }

    // InitializeCore: 엔트리 모듈 직전에 실행 (Metro runBeforeMainModule 호환)
    const initCorePath = tryResolve('react-native/Libraries/Core/InitializeCore', config.root);
    if (initCorePath) {
      args.push(`--run-before-main=${initCorePath}`);
    }

    // codegen: codegenNativeComponent 사용 앱은 별도 Babel 플러그인 필요.
    // bungae.config.ts의 transformer.babel.presets에 추가:
    //   presets: ['@react-native/babel-plugin-codegen']
    // ZTS는 Babel 직접 실행 불가이므로 --plugin으로 사전 변환된 코드를 전달.
    // (대부분의 앱은 빌드 시 이미 codegen 완료 — runtime codegen 불필요)

    // RN 예약 전역 식별자 — polyfillGlobal()로 등록되는 이름과 모듈 변수 충돌 방지
    // 롤다운의 globalIdentifiers와 동일한 목록 (RN 0.83 기준)
    for (const name of RN_GLOBAL_IDENTIFIERS) {
      args.push(`--global-identifier=${name}`);
    }

    // 에셋 플러그인: require('./image.png') → AssetRegistry.registerAsset({...})
    const assetPluginPath = resolve(__dirname, 'asset-plugin.ts');
    if (existsSync(assetPluginPath)) {
      args.push('--plugin', assetPluginPath);
    }

    // Babel 플러그인: 커스텀 Babel 플러그인이 있으면 transform 훅으로 실행
    const babelPluginPath = resolve(__dirname, 'babel-plugin.ts');
    if (existsSync(babelPluginPath)) {
      args.push('--plugin', babelPluginPath);
      // 멀티스레드 + IPC 플러그인 경합 방지: 단일 스레드로 실행
      args.push('--jobs=1');
    }
  }

  // Watch mode with NDJSON output
  if (watchMode) {
    args.push('--watch-json');
  }

  // Format: RN은 자체 JS 컨텍스트에서 실행하므로 IIFE 불필요 (Metro도 미사용)

  return args;
}

export interface ZtsProcess extends EventEmitter {
  on(event: 'ready', listener: (data: ZtsReadyEvent) => void): this;
  on(event: 'rebuild', listener: (data: ZtsRebuildEvent) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number | null) => void): this;
  emit(event: 'ready', data: ZtsReadyEvent): boolean;
  emit(event: 'rebuild', data: ZtsRebuildEvent): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'exit', code: number | null): boolean;
  kill(): void;
}

/**
 * Spawn zts process in watch mode.
 * Returns an EventEmitter that emits NDJSON events.
 */
export function spawnZtsWatch(config: ResolvedConfig, outputPath: string): ZtsProcess {
  const binaryPath = findZtsBinary(config.root);
  const args = buildZtsArgs(config, outputPath, true);

  const child: ChildProcess = spawn(binaryPath, args, {
    cwd: config.root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: config.dev ? 'development' : 'production',
      ZTS_PROJECT_ROOT: config.root,
      ZTS_ASSET_EXTS: config.resolver.assetExts.join(','),
      ZTS_RN_PLATFORM: config.platform === 'android' ? 'android' : 'ios',
      ZTS_SOURCE_EXTS: config.resolver.sourceExts.map((e) => `.${e}`).join(','),
    },
  });

  const emitter = new EventEmitter() as ZtsProcess;

  // Parse NDJSON from stdout
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    // Keep the last incomplete line in buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event: ZtsEvent = JSON.parse(line);
        (emitter as EventEmitter).emit(event.type, event);
      } catch {
        // Not JSON — skip non-event stdout silently
      }
    }
  });

  // Forward stderr — buffer lines + aggregate circular dependency warnings
  let stderrBuffer = '';
  let circularDepCount = 0;
  let circularDepTimer: ReturnType<typeof setTimeout> | null = null;

  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    const parts = stderrBuffer.split('\n');
    // Keep last incomplete line in buffer
    stderrBuffer = parts.pop() || '';

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.includes('Circular dependency detected')) {
        circularDepCount++;
        if (circularDepTimer) clearTimeout(circularDepTimer);
        circularDepTimer = setTimeout(() => {
          if (circularDepCount > 0) {
            logWarn(`${circularDepCount} circular dependency warning(s) detected`);
            circularDepCount = 0;
          }
        }, 100);
      } else if (trimmed.startsWith('[warning]')) {
        // Skip other warnings silently (non-circular)
      } else {
        // Non-warning stderr (real errors)
        console.error(trimmed);
      }
    }
  });

  child.on('error', (error: Error) => {
    emitter.emit('error', error);
  });

  child.on('exit', (code: number | null) => {
    emitter.emit('exit', code);
  });

  emitter.kill = () => {
    child.kill('SIGTERM');
  };

  return emitter;
}

/**
 * Run zts one-shot build (no watch mode).
 */
export async function runZtsBuild(
  config: ResolvedConfig,
  outputPath: string,
): Promise<{ success: boolean; error?: string }> {
  const binaryPath = findZtsBinary(config.root);
  const args = buildZtsArgs(config, outputPath, false);

  console.log(`[zts] Binary: ${binaryPath}`);
  console.log(`[zts] Args: ${args.join(' ')}`);

  // Use execFileSync to avoid Bun's child_process.spawn IPC issues
  // with nested sub-processes (ZTS → bun run babel-plugin.ts)
  const { execFileSync } = require('child_process');
  try {
    execFileSync(binaryPath, args, {
      cwd: config.root,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: {
        ...process.env,
        NODE_ENV: config.dev ? 'development' : 'production',
        ZTS_PROJECT_ROOT: config.root,
        ZTS_ASSET_EXTS: config.resolver.assetExts.join(','),
        ZTS_RN_PLATFORM: config.platform === 'android' ? 'android' : 'ios',
        ZTS_SOURCE_EXTS: config.resolver.sourceExts.map((e) => `.${e}`).join(','),
      },
      maxBuffer: 50 * 1024 * 1024,
    });
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.stderr?.toString()?.trim() || err.message || 'zts build failed',
    };
  }
}


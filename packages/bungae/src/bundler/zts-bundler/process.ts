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

/** NDJSON event from zts --watch-json */
export interface ZtsReadyEvent {
  type: 'ready';
  files: number;
}

export interface ZtsRebuildEvent {
  type: 'rebuild';
  success: boolean;
  changed?: string[];
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
  // Check zts submodule in the bungae workspace root
  const candidates = [
    join(projectRoot, 'zts/zig-out/bin/zts'),
    join(projectRoot, '../zts/zig-out/bin/zts'),
    // Walk up to find workspace root with zts submodule
    resolve(projectRoot, '../../zts/zig-out/bin/zts'),
  ];

  // Also check relative to this file's location (bungae repo)
  const bungaeRoot = resolve(__dirname, '../../../../..');
  candidates.push(join(bungaeRoot, 'zts/zig-out/bin/zts'));

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
    // RN uses `global` instead of `globalThis`
    args.push('--define:global=globalThis');
    // RN platform-specific extensions (.ios.js, .android.js)
    const rnPlatform = config.platform === 'ios' ? 'ios' : config.platform === 'android' ? 'android' : 'ios';
    args.push(`--rn-platform=${rnPlatform}`);
  }

  // Watch mode with NDJSON output
  if (watchMode) {
    args.push('--watch-json');
  }

  // Format: react-native defaults to IIFE in zts
  // No need to set explicitly

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

  console.log(`[zts] Binary: ${binaryPath}`);
  console.log(`[zts] Args: ${args.join(' ')}`);

  const child: ChildProcess = spawn(binaryPath, args, {
    cwd: config.root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Pass NODE_ENV for define substitution
      NODE_ENV: config.dev ? 'development' : 'production',
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
        // Not JSON, treat as regular stdout
        console.log(`[zts] ${line}`);
      }
    }
  });

  // Forward stderr
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      console.error(`[zts] ${text}`);
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

  return new Promise((resolve) => {
    const child = spawn(binaryPath, args, {
      cwd: config.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: config.dev ? 'development' : 'production',
      },
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      if (code === 0 || code === null) {
        // code === null means killed by signal, but bundle may have been written
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr.trim() || `zts exited with code ${code} (signal: ${signal})` });
      }
    });

    child.on('error', (error: Error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

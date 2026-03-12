/**
 * Hermes Bytecode Compiler
 *
 * Compiles JavaScript bundles to Hermes bytecode (.hbc) for faster app startup.
 * Uses hermesc from react-native SDK.
 *
 * Pipeline: JS Bundle → hermesc → .hbc (bytecode) + .hbc.map (source map)
 */

import { execFile } from 'child_process';
import { existsSync, statSync } from 'fs';
import { promisify } from 'util';

import type { HermesCompileResult } from '../types';
import { findHermesc } from './find-hermesc';

const execFileAsync = promisify(execFile);

export interface HermesCompileOptions {
  /** Input JS bundle path */
  input: string;
  /** Output .hbc file path */
  output: string;
  /** Generate source map */
  sourceMap?: boolean;
  /** Input source map path (for source map chaining) */
  inputSourceMap?: string;
  /** Enable Hermes optimizations */
  optimize?: boolean;
  /** Project root for finding hermesc */
  projectRoot: string;
}

/**
 * Compile JS bundle to Hermes bytecode
 *
 * @returns Compilation result with output path, size, and duration
 * @throws Error if hermesc is not found or compilation fails
 */
export async function compileToHermesBytecode(
  options: HermesCompileOptions,
): Promise<HermesCompileResult> {
  const { input, output, sourceMap = true, inputSourceMap, optimize = true, projectRoot } = options;

  // Find hermesc binary
  const hermescPath = findHermesc(projectRoot);
  if (!hermescPath) {
    throw new Error(
      'hermesc not found. Ensure react-native is installed and contains sdks/hermesc/.',
    );
  }

  if (!existsSync(input)) {
    throw new Error(`Input bundle not found: ${input}`);
  }

  // Build hermesc arguments
  const args: string[] = ['-emit-binary', '-out', output];

  if (optimize) {
    args.push('-O');
  }

  // Source map chaining: JS source map → Hermes source map
  let sourceMapPath: string | undefined;
  if (sourceMap) {
    sourceMapPath = `${output}.map`;
    args.push('-output-source-map');

    if (inputSourceMap && existsSync(inputSourceMap)) {
      args.push('-source-map', inputSourceMap);
    }
  }

  // Add input file
  args.push(input);

  // Execute hermesc
  const startTime = Date.now();

  try {
    await execFileAsync(hermescPath, args, {
      timeout: 300_000, // 5 minutes max
    });
  } catch (error: any) {
    throw new Error(`Hermes compilation failed: ${error.stderr || error.message}`);
  }

  const duration = Date.now() - startTime;

  if (!existsSync(output)) {
    throw new Error(`Hermes output not found: ${output}`);
  }

  const size = statSync(output).size;

  return {
    outputPath: output,
    sourceMapPath,
    duration,
    size,
  };
}

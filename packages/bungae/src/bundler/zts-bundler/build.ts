/**
 * ZTS one-shot build
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { ResolvedConfig } from '../../config/types';
import type { BuildResult } from '../graph-bundler';
import { runZtsBuild } from './process';

/**
 * Build bundle using zts (one-shot, no watch)
 */
export async function buildWithZts(
  config: ResolvedConfig,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
): Promise<BuildResult> {
  const outputPath = join(config.outDir, 'bundle.js');
  const sourceMapPath = `${outputPath}.map`;

  console.log('📦 Using zts-bundler (Zig, fast)');

  // Signal start
  onProgress?.(0, 1);

  const result = await runZtsBuild(config, outputPath);

  if (!result.success) {
    throw new Error(`zts build failed: ${result.error}`);
  }

  // Read output files
  const code = readFileSync(outputPath, 'utf-8');
  let map: string | undefined;
  try {
    map = readFileSync(sourceMapPath, 'utf-8');
  } catch {
    // Source map may not exist if not requested
  }

  // Signal completion
  onProgress?.(1, 1);

  return { code, map };
}

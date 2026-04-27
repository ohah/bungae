import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { readTsConfigPathAliases } from '../zts-bundler/napi-build';

describe('zts NAPI options', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-zts-napi-options-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('tsconfig trailing wildcard paths become ZTS aliases', () => {
    writeFileSync(
      join(testDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          paths: {
            '@/*': ['./*'],
          },
        },
      }),
      'utf8',
    );

    expect(readTsConfigPathAliases(testDir)).toEqual({
      '@': testDir,
    });
  });

  test('non-prefix-safe paths are ignored', () => {
    writeFileSync(
      join(testDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          paths: {
            '@exact': ['./src/index.ts'],
            'pkg/*/test': ['./src/*/test'],
          },
        },
      }),
      'utf8',
    );

    expect(readTsConfigPathAliases(testDir)).toEqual({});
  });
});

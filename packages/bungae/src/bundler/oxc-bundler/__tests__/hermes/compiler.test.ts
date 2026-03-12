import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { compileToHermesBytecode } from '../../hermes/compiler';

describe('compileToHermesBytecode', () => {
  const testDir = join(tmpdir(), 'bungae-hermes-compiler-test');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should throw when hermesc is not found', async () => {
    const inputPath = join(testDir, 'bundle.js');
    writeFileSync(inputPath, 'console.log("hello");');

    await expect(
      compileToHermesBytecode({
        input: inputPath,
        output: join(testDir, 'bundle.hbc'),
        projectRoot: '/nonexistent/path',
      }),
    ).rejects.toThrow('hermesc not found');
  });

  it('should throw when input bundle does not exist', async () => {
    // Need to set up fake hermesc first so we get past the hermesc check
    const platform = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'win64' : 'linux64';
    const rnDir = join(testDir, 'node_modules', 'react-native');
    const hermescDir = join(rnDir, 'sdks', 'hermesc', `${platform}-bin`);
    mkdirSync(hermescDir, { recursive: true });
    writeFileSync(join(rnDir, 'package.json'), '{"name": "react-native", "version": "0.83.0"}');
    writeFileSync(join(hermescDir, 'hermesc'), '#!/bin/bash\nexit 0');
    chmodSync(join(hermescDir, 'hermesc'), 0o755);

    await expect(
      compileToHermesBytecode({
        input: join(testDir, 'nonexistent.js'),
        output: join(testDir, 'bundle.hbc'),
        projectRoot: testDir,
      }),
    ).rejects.toThrow('Input bundle not found');
  });

  it('should compile JS to bytecode when hermesc is available', async () => {
    // Create fake hermesc that produces output
    const platform = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'win64' : 'linux64';
    const rnDir = join(testDir, 'node_modules', 'react-native');
    const hermescDir = join(rnDir, 'sdks', 'hermesc', `${platform}-bin`);
    mkdirSync(hermescDir, { recursive: true });
    writeFileSync(join(rnDir, 'package.json'), '{"name": "react-native", "version": "0.83.0"}');

    // Create a fake hermesc script that creates output file
    const hermescScript = join(hermescDir, 'hermesc');
    writeFileSync(
      hermescScript,
      `#!/bin/bash
OUT=""
while [[ $# -gt 0 ]]; do
  case $1 in
    -out) OUT="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$OUT" ]; then
  echo "HERMES_BYTECODE" > "$OUT"
fi
`,
    );
    chmodSync(hermescScript, 0o755);

    const inputPath = join(testDir, 'bundle.js');
    const outputPath = join(testDir, 'bundle.hbc');
    writeFileSync(inputPath, 'console.log("hello");');

    const result = await compileToHermesBytecode({
      input: inputPath,
      output: outputPath,
      sourceMap: false,
      optimize: true,
      projectRoot: testDir,
    });

    expect(result.outputPath).toBe(outputPath);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.size).toBeGreaterThan(0);
    expect(existsSync(outputPath)).toBe(true);
  });
});

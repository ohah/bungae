#!/usr/bin/env node
/**
 * Bungae CLI Entry Point
 *
 * This is a Node.js entry point that spawns the actual CLI using Bun runtime.
 * Bun is installed as a dependency, so we use node_modules/bun directly.
 */

import { spawnSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { join, dirname } from 'path';

// Get current directory from the actual script location at runtime
// Use realpathSync to resolve symlinks (node_modules/.bin/bungae -> ../bungae/dist/cli.cjs)
const scriptPath = realpathSync(process.argv[1] || '');
const currentDir = dirname(scriptPath);

// Find bun executable from dependencies first, then fallback to global
function findBun(): string | null {
  // 1. Check installed dependency (bun package)
  // After npm install, bun binary is at node_modules/bun/bin/bun.exe
  const depBunExe = join(currentDir, '..', 'node_modules', 'bun', 'bin', 'bun.exe');
  if (existsSync(depBunExe)) {
    return depBunExe;
  }

  // 2. Check node_modules/.bin/bun symlink
  const binBun = join(currentDir, '..', 'node_modules', '.bin', 'bun');
  if (existsSync(binBun)) {
    return binBun;
  }

  // 3. Fallback to global bun in PATH
  const result = spawnSync('which', ['bun'], { encoding: 'utf-8', stdio: 'pipe' });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }

  return null;
}

const bunPath = findBun();

if (!bunPath) {
  console.error('\x1b[31mError: Bun runtime not found.\x1b[0m\n');
  console.error('Bungae requires Bun. It should be installed as a dependency.');
  console.error('');
  console.error('Try reinstalling:');
  console.error('  npm install bungae');
  console.error('');
  console.error('Or install Bun globally:');
  console.error('  curl -fsSL https://bun.sh/install | bash');
  console.error('');
  process.exit(1);
}

// Get the actual CLI implementation path
// Use .cjs extension since we're running with Bun and want CommonJS
const cliImplPath = join(currentDir, 'main.cjs');

// Spawn bun with the actual CLI implementation
const result = spawnSync(bunPath, [cliImplPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});

process.exit(result.status ?? 1);

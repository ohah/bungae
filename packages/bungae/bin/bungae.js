#!/usr/bin/env node

// src/cli.ts
var import_child_process = require('child_process');
var import_fs = require('fs');
var import_path = require('path');
var import_os = require('os');
var scriptPath = import_fs.realpathSync(process.argv[1] || '');
var currentDir = import_path.dirname(scriptPath);
function findPlatformExecutable() {
  const platformName = import_os.platform();
  const archName = import_os.arch();
  let executableName;
  if (platformName === 'win32') {
    executableName = 'bungae-windows-x64.exe';
  } else if (platformName === 'darwin') {
    if (archName === 'arm64') {
      executableName = 'bungae-darwin-arm64';
    } else {
      executableName = 'bungae-darwin-x64';
    }
  } else {
    executableName = 'bungae-linux-x64';
  }
  const binDir = import_path.join(currentDir, '..', 'bin');
  const executablePath = import_path.join(binDir, executableName);
  if (import_fs.existsSync(executablePath)) {
    return executablePath;
  }
  return null;
}
function findBun() {
  const depBunExe = import_path.join(currentDir, '..', 'node_modules', 'bun', 'bin', 'bun.exe');
  if (import_fs.existsSync(depBunExe)) {
    return depBunExe;
  }
  const binBun = import_path.join(currentDir, '..', 'node_modules', '.bin', 'bun');
  if (import_fs.existsSync(binBun)) {
    return binBun;
  }
  const result = import_child_process.spawnSync('which', ['bun'], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return null;
}
var platformExecutable = findPlatformExecutable();
if (platformExecutable) {
  const result = import_child_process.spawnSync(platformExecutable, process.argv.slice(2), {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  process.exit(result.status ?? 1);
}
var bunPath = findBun();
if (!bunPath) {
  console.error(`\x1B[31mError: Bun runtime not found.\x1B[0m
`);
  console.error('Bungae requires either:');
  console.error('  1. Platform-specific executable (build with: bun run build)');
  console.error('  2. Bun runtime installed');
  console.error('');
  console.error('Try reinstalling:');
  console.error('  npm install bungae');
  console.error('');
  console.error('Or install Bun globally:');
  console.error('  curl -fsSL https://bun.sh/install | bash');
  console.error('');
  process.exit(1);
}
var cliImplPath = import_path.join(currentDir, '..', 'dist', 'cli-impl.cjs');
var result = import_child_process.spawnSync(bunPath, [cliImplPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});
process.exit(result.status ?? 1);

//# debugId=C52D80A3E40637FF64756E2164756E21
//# sourceMappingURL=cli.js.map

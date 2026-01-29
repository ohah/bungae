#!/usr/bin/env bun
/**
 * Build script using Bun's native bundler
 * Replaces bunup to avoid dependency issues in CI
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { platform } from 'os';
import { join } from 'path';

const ROOT = import.meta.dir.replace('/cli', '');
const DIST = join(ROOT, 'dist');

// External dependencies that should not be bundled
const external = [
  'react-native',
  'hermes-parser',
  'babel-plugin-syntax-hermes-parser',
  '@babel/core',
  '@babel/plugin-transform-flow-strip-types',
  '@swc/core',
  '@react-native/babel-preset',
  '@react-native/babel-plugin-codegen',
  // All @babel/* packages
  '@babel/generator',
  '@babel/traverse',
  '@babel/types',
  '@babel/plugin-transform-class-properties',
  '@babel/plugin-transform-modules-commonjs',
  '@babel/plugin-transform-private-methods',
  '@babel/plugin-transform-private-property-in-object',
  '@babel/plugin-transform-react-jsx',
  '@babel/preset-flow',
  // All @react-native/* packages
  '@react-native/dev-middleware',
  '@react-native-community/cli-server-api',
  // Node.js built-ins used at runtime
  'child_process',
  'fs',
  'path',
  'os',
  'util',
  'http',
  'https',
  'net',
  'stream',
  'events',
  'crypto',
  'url',
  'zlib',
  'buffer',
  'assert',
  // Other externals
  'source-map',
  'terser',
  'vlq',
  'ws',
  'metro-runtime',
  'metro-source-map',
  'flow-parser',
  'oxc-parser',
  'oxc-transform',
  'jsc-safe-url',
  'bun',
];

async function build() {
  console.log('🔨 Building Bungae...\n');

  // Clean dist folder
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true });
  }
  mkdirSync(DIST, { recursive: true });

  // Entry points: library + CLI
  const entrypoints = [
    join(ROOT, 'src/index.ts'), // Library entry
    join(ROOT, 'cli/entry.ts'), // CLI entry (Node.js wrapper)
    join(ROOT, 'cli/main.ts'), // CLI implementation (Bun runtime)
  ];

  // Build ESM
  console.log('📦 Building ESM...');
  const esmResult = await Bun.build({
    entrypoints,
    outdir: DIST,
    target: 'node',
    format: 'esm',
    sourcemap: 'linked',
    splitting: false,
    external,
    naming: '[name].js',
  });

  if (!esmResult.success) {
    console.error('ESM build failed:');
    for (const log of esmResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  console.log('  ✓ ESM build complete');

  // Build CJS
  console.log('📦 Building CJS...');
  const cjsResult = await Bun.build({
    entrypoints,
    outdir: DIST,
    target: 'node',
    format: 'cjs',
    sourcemap: 'linked',
    splitting: false,
    external,
    naming: '[name].cjs',
  });

  if (!cjsResult.success) {
    console.error('CJS build failed:');
    for (const log of cjsResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  console.log('  ✓ CJS build complete');

  // Generate type declarations using tsc
  // Note: Must override noEmit from root tsconfig.json
  console.log('📝 Generating type declarations...');
  const tscResult = Bun.spawnSync(
    [
      'bun',
      'x',
      'tsc',
      '--declaration',
      '--emitDeclarationOnly',
      '--noEmit',
      'false',
      '--outDir',
      DIST,
    ],
    { cwd: ROOT },
  );

  if (tscResult.exitCode !== 0) {
    console.warn('  ⚠ Type declaration generation failed (non-critical)');
    console.warn(tscResult.stderr.toString());
  } else {
    console.log('  ✓ Type declarations generated');
  }

  // Keep only necessary .d.ts files and create .d.cts copies
  const { existsSync: exists, copyFileSync, readdirSync: readdir, statSync } = await import('fs');

  // Copy graph-bundler runtime (Bungae HMR client) to dist for InitializeCore + HMR-only replacement
  const runtimeDir = join(DIST, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const runtimeSrc = join(
    ROOT,
    'src',
    'bundler',
    'graph-bundler',
    'runtime',
    'bungae-hmr-client.js',
  );
  if (existsSync(runtimeSrc)) {
    copyFileSync(runtimeSrc, join(runtimeDir, 'bungae-hmr-client.js'));
    console.log('  ✓ Runtime (bungae-hmr-client.js) copied');
  }

  // Copy type declarations from tsc output structure to dist root
  const typeMappings = [
    { from: 'src/index.d.ts', to: 'index.d.ts' },
    { from: 'cli/entry.d.ts', to: 'entry.d.ts' },
    { from: 'cli/main.d.ts', to: 'main.d.ts' },
  ];
  for (const { from, to } of typeMappings) {
    const srcPath = join(DIST, from);
    if (exists(srcPath)) {
      copyFileSync(srcPath, join(DIST, to));
      copyFileSync(srcPath, join(DIST, to.replace('.d.ts', '.d.cts')));
    }
  }
  console.log('  ✓ Type declarations copied');
  console.log('  ✓ CJS type declarations created');

  // Clean up unnecessary directories created by tsc
  const dirsToRemove = [
    '__tests__',
    'bundler',
    'config',
    'graph',
    'resolver',
    'serializer',
    'transformer',
    'types',
    'cli', // CLI types are at root level
    'src', // Source types are at root level
  ];
  for (const dir of dirsToRemove) {
    const dirPath = join(DIST, dir);
    if (exists(dirPath)) {
      rmSync(dirPath, { recursive: true });
    }
  }

  // Remove unnecessary .d.ts files (keep only index, entry, main)
  const filesToKeep = new Set([
    'index.js',
    'index.js.map',
    'index.cjs',
    'index.cjs.map',
    'index.d.ts',
    'index.d.cts',
    'entry.js',
    'entry.js.map',
    'entry.cjs',
    'entry.cjs.map',
    'entry.d.ts',
    'entry.d.cts',
    'main.js',
    'main.js.map',
    'main.cjs',
    'main.cjs.map',
    'main.d.ts',
    'main.d.cts',
  ]);
  for (const file of readdir(DIST)) {
    if (!filesToKeep.has(file) && statSync(join(DIST, file)).isFile()) {
      rmSync(join(DIST, file));
    }
  }

  // Make CLI executable on Unix
  if (platform() !== 'win32') {
    const { chmodSync } = await import('fs');
    try {
      chmodSync(join(DIST, 'entry.cjs'), 0o755);
      console.log('  ✓ CLI made executable');
    } catch {
      // Ignore chmod errors
    }
  }

  console.log('\n✅ Build complete!');

  // Print output summary
  const distFiles = readdir(DIST);
  console.log('\nOutput files:');
  for (const file of distFiles.sort()) {
    const stat = statSync(join(DIST, file));
    const size = (stat.size / 1024).toFixed(2);
    console.log(`  ${file.padEnd(25)} ${size.padStart(8)} KB`);
  }
}

build().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});

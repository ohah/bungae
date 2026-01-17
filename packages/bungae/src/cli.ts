#!/usr/bin/env bun
/**
 * Bungae CLI
 */

import { parseArgs } from 'util';

import { VERSION, build, serve } from './index.ts';

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    platform: { type: 'string', short: 'p' },
    dev: { type: 'boolean', short: 'd' },
    minify: { type: 'boolean', short: 'm' },
    entry: { type: 'string', short: 'e' },
    outDir: { type: 'string', short: 'o' },
  },
  allowPositionals: true,
});

const command = positionals[0];

async function main() {
  if (values.version) {
    console.log(`bungae v${VERSION}`);
    process.exit(0);
  }

  if (values.help || !command) {
    console.log(`
bungae v${VERSION} - A lightning-fast React Native bundler powered by Bun

Usage:
  bungae <command> [options]

Commands:
  build     Build the React Native bundle
  serve     Start the development server
  start     Alias for serve

Options:
  -h, --help       Show this help message
  -v, --version    Show version number
  -p, --platform   Target platform (ios, android)
  -d, --dev        Development mode
  -m, --minify     Enable minification
  -e, --entry      Entry file path
  -o, --outDir     Output directory

Examples:
  bungae serve --platform ios
  bungae build --platform android --minify
`);
    process.exit(0);
  }

  const config = {
    platform: values.platform as 'ios' | 'android' | undefined,
    dev: values.dev ?? (command === 'serve' || command === 'start'),
    minify: values.minify,
    entry: values.entry,
    outDir: values.outDir,
  };

  switch (command) {
    case 'build':
      await build(config);
      break;
    case 'serve':
    case 'start':
      await serve(config);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

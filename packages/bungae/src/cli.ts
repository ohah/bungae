#!/usr/bin/env bun
/**
 * Bungae CLI
 */

import { resolve, dirname } from 'path';
import { parseArgs } from 'util';

import { loadConfig, resolveConfig } from './config';
import type { BungaeConfig } from './config/types';
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
    config: { type: 'string', short: 'c' },
    root: { type: 'string' },
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
  -p, --platform   Target platform (ios, android, web)
  -d, --dev        Development mode
  -m, --minify     Enable minification
  -e, --entry      Entry file path
  -o, --outDir     Output directory
  -c, --config     Path to config file
  --root           Project root directory

Examples:
  bungae serve --platform ios
  bungae build --platform android --minify
  bungae build --config ./custom.config.ts
`);
    process.exit(0);
  }

  // Determine project root
  const projectRoot = values.root
    ? resolve(values.root)
    : values.config
      ? resolve(dirname(values.config))
      : process.cwd();

  // Load config from file (Metro-compatible API)
  let fileConfig: BungaeConfig = {};
  try {
    if (values.config) {
      // Load from specified config file
      fileConfig = await loadConfig({ config: values.config, cwd: projectRoot });
    } else {
      // Load from default locations
      fileConfig = await loadConfig({ cwd: projectRoot });
    }
  } catch (error) {
    console.warn(`Warning: Failed to load config file: ${error}`);
    // Continue with CLI options only
  }

  // Merge CLI options with file config
  const cliConfig: BungaeConfig = {
    root: projectRoot,
    platform: values.platform as 'ios' | 'android' | 'web' | undefined,
    dev:
      values.dev !== undefined
        ? values.dev
        : command === 'serve' || command === 'start'
          ? true
          : undefined,
    minify: values.minify,
    entry: values.entry,
    outDir: values.outDir,
  };

  // Remove undefined values
  Object.keys(cliConfig).forEach((key) => {
    if (cliConfig[key as keyof BungaeConfig] === undefined) {
      delete cliConfig[key as keyof BungaeConfig];
    }
  });

  // Merge configs (CLI options override file config)
  const mergedConfig: BungaeConfig = {
    ...fileConfig,
    ...cliConfig,
  };

  // Resolve config with defaults
  const resolvedConfig = resolveConfig(mergedConfig, projectRoot);

  switch (command) {
    case 'build':
      await build(resolvedConfig);
      break;
    case 'serve':
    case 'start':
      await serve(resolvedConfig);
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

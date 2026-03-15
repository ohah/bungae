/**
 * Bungae CLI Implementation
 *
 * This file contains the actual CLI logic and runs under Bun runtime.
 * It uses Bun APIs (Bun.Transpiler, Bun.serve, etc.)
 *
 * Supports all Metro and React Native CLI compatible options as a superset.
 */

import { resolve, dirname } from 'path';

import { loadConfig, resolveConfig } from '../src/config';
import type { BungaeConfig } from '../src/config/types';
import { VERSION, build, serve } from '../src/index.ts';
import { buildConfigFromArgs } from './build-config';
import { parseCliArgs } from './parse-args';

const parsed = parseCliArgs(process.argv.slice(2));

function printHelp() {
  console.log(`
bungae v${VERSION} - A lightning-fast React Native bundler powered by Bun

Usage:
  bungae <command> [options]

Commands:
  build          Build the React Native bundle
  serve          Start the development server
  start          Alias for serve
  dependencies   List all module dependencies

Common Options:
  -h, --help                       Show this help message
  -v, --version                    Show version number
  -p, --platform <string>          Target platform (ios, android, web)
  -d, --dev                        Development mode
  -m, --minify                     Enable minification
  --mode <string>                  Build mode (development, production, release)
  -e, --entry <path>               Entry file path
  --entry-file <path>              Entry file path (RN CLI compat)
  -c, --config <path>              Path to config file
  --root <path>                    Project root directory
  --bundler <string>               Bundler type (graph, bun, oxc)
  -j, --max-workers <number>       Maximum number of worker threads
  --reset-cache                    Clear bundler cache before building

Server Options (serve/start):
  --host <string>                  Host to bind server to (default: localhost)
  --port <number>                  Port number (default: 8081)
  --https                          Enable HTTPS
  --key <path>                     Path to SSL key file
  --cert <path>                    Path to SSL cert file
  --no-interactive                 Disable interactive terminal mode
  --watchFolders <list>            Additional watch folders (comma-separated)
  --sourceExts <list>              Additional source file extensions (comma-separated)

Build Options (build):
  -o, --outDir <path>              Output directory
  -O, --out <path>                 Output bundle file path (Metro compat)
  --bundle-output <path>           Output bundle file path (RN CLI compat)
  --bundle-encoding <string>       Output encoding (default: utf8)
  --source-map                     Generate source map
  --source-map-url <string>        Source map URL override
  --sourcemap-output <path>        Source map output file path
  --sourcemap-sources-root <path>  Root path for source map sources
  --sourcemap-use-absolute-path    Use absolute paths in source maps
  --assets-dest <path>             Assets output directory
  --asset-catalog-dest <path>      iOS asset catalog destination
  --unstable-transform-profile <string>  JS engine profile (default, hermes-stable, hermes-canary)
  --transform-option <key=value>   Custom transform options (repeatable)
  --resolver-option <key=value>    Custom resolver options (repeatable)

Dependencies Options (dependencies):
  --entry-file <path>              Root JS file path
  --output <path>                  Output file (default: stdout)
  --verbose                        Enable verbose logging

Examples:
  bungae serve --platform ios
  bungae serve --port 8082 --host 0.0.0.0
  bungae serve --https --key ./key.pem --cert ./cert.pem
  bungae build --platform android --minify
  bungae build --platform ios --bundle-output ./ios/main.jsbundle
  bungae build --platform android --assets-dest ./android/app/src/main/res
  bungae build --platform android --mode release
  bungae build --source-map --sourcemap-output ./dist/bundle.map
  bungae dependencies --entry-file ./src/index.ts --platform ios
`);
}

async function main() {
  if (parsed.version) {
    console.log(`bungae v${VERSION}`);
    process.exit(0);
  }

  if (parsed.help || !parsed.command) {
    printHelp();
    process.exit(0);
  }

  // Determine project root
  const projectRoot = parsed.root
    ? resolve(parsed.root)
    : parsed.config
      ? resolve(dirname(parsed.config))
      : process.cwd();

  // Load config from file (Metro-compatible API)
  let fileConfig: BungaeConfig = {};
  try {
    if (parsed.config) {
      fileConfig = await loadConfig({ config: parsed.config, cwd: projectRoot });
    } else {
      fileConfig = await loadConfig({ cwd: projectRoot });
    }
  } catch (error) {
    console.warn(`Warning: Failed to load config file: ${error}`);
  }

  // Build CLI config from parsed args
  const cliConfig = buildConfigFromArgs(parsed);

  // Remove undefined values
  const cleanedConfig: BungaeConfig = {};
  for (const [key, value] of Object.entries(cliConfig)) {
    if (value !== undefined) {
      (cleanedConfig as any)[key] = value;
    }
  }

  // Merge configs (CLI options override file config)
  const mergedConfig: BungaeConfig = {
    ...fileConfig,
    ...cleanedConfig,
    // Deep merge server config
    server: {
      ...fileConfig.server,
      ...cleanedConfig.server,
    },
  };

  // Resolve config with defaults
  const resolvedConfig = resolveConfig(mergedConfig, projectRoot);

  switch (parsed.command) {
    case 'build':
      await build(resolvedConfig);
      break;
    case 'serve':
    case 'start':
      await serve(resolvedConfig);
      break;
    case 'dependencies':
      console.error('Dependencies command is not yet implemented.');
      process.exit(1);
      break;
    default:
      console.error(`Unknown command: ${parsed.command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

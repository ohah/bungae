/**
 * CLI argument parsing module
 *
 * Parses command-line arguments into a structured format.
 * Supports all Metro and React Native CLI compatible options as a superset.
 *
 * Metro CLI options: serve (--host, --port, --hmr, --secure-*), build (--out, --source-map, --source-map-url, --legacy-bundler)
 * RN CLI options: start (--watchFolders, --sourceExts, --no-interactive, --client-logs), bundle (--bundle-output, --sourcemap-output, --assets-dest, --unstable-transform-profile)
 * Bungae-specific: --mode, --bundler
 */

import { parseArgs as nodeParseArgs } from 'util';

export type Command = 'build' | 'serve' | 'start' | 'dependencies';

export interface ParsedArgs {
  command: Command | undefined;
  help: boolean;
  version: boolean;

  // --- Common options ---
  platform?: string;
  dev?: boolean;
  minify?: boolean;
  mode?: string;
  entry?: string;
  config?: string;
  root?: string;
  bundler?: string;
  maxWorkers?: number;
  resetCache?: boolean;
  interactive?: boolean;

  // --- Server options (serve/start) ---
  host?: string;
  port?: number;
  https?: boolean;
  key?: string;
  cert?: string;
  watchFolders?: string[];
  sourceExts?: string[];

  // --- Build options (build/bundle) ---
  outDir?: string;
  bundleOutput?: string;
  bundleEncoding?: string;
  sourcemap?: boolean;
  sourcemapOutput?: string;
  sourcemapSourcesRoot?: string;
  sourcemapUseAbsolutePath?: boolean;
  sourceMapUrl?: string;
  assetsDest?: string;
  assetCatalogDest?: string;
  unstableTransformProfile?: string;

  // --- Advanced options ---
  transformOption?: string[];
  resolverOption?: string[];

  // --- Dependencies command ---
  output?: string;
  verbose?: boolean;
}

/**
 * Parse key=value pairs into a Record
 */
export function parseKeyValuePairs(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) {
      result[pair] = 'true';
    } else {
      result[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
    }
  }
  return result;
}

/**
 * Parse comma-separated string into array
 */
export function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse CLI arguments into a structured ParsedArgs object.
 *
 * @param argv - Raw argument array (typically process.argv.slice(2))
 * @returns Parsed arguments with command and all option values
 */
export function parseCliArgs(argv: string[]): ParsedArgs {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: {
      // --- Meta ---
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },

      // --- Common ---
      platform: { type: 'string', short: 'p' },
      dev: { type: 'boolean', short: 'd' },
      minify: { type: 'boolean', short: 'm' },
      mode: { type: 'string' },
      entry: { type: 'string', short: 'e' },
      config: { type: 'string', short: 'c' },
      root: { type: 'string' },
      bundler: { type: 'string' },
      'max-workers': { type: 'string', short: 'j' },
      'reset-cache': { type: 'boolean' },
      resetCache: { type: 'boolean' },
      interactive: { type: 'boolean' },
      'no-interactive': { type: 'boolean' },

      // --- Server options ---
      host: { type: 'string' },
      port: { type: 'string' },
      https: { type: 'boolean' },
      key: { type: 'string' },
      cert: { type: 'string' },
      watchFolders: { type: 'string' },
      'watch-folders': { type: 'string' },
      sourceExts: { type: 'string' },
      'source-exts': { type: 'string' },

      // --- Build options ---
      outDir: { type: 'string', short: 'o' },
      'out-dir': { type: 'string' },
      out: { type: 'string', short: 'O' },
      'bundle-output': { type: 'string' },
      'bundle-encoding': { type: 'string' },
      'source-map': { type: 'boolean' },
      'source-map-url': { type: 'string' },
      'sourcemap-output': { type: 'string' },
      'sourcemap-sources-root': { type: 'string' },
      'sourcemap-use-absolute-path': { type: 'boolean' },
      'assets-dest': { type: 'string' },
      'asset-catalog-dest': { type: 'string' },
      'unstable-transform-profile': { type: 'string' },

      // --- Advanced ---
      'transform-option': { type: 'string', multiple: true },
      'resolver-option': { type: 'string', multiple: true },

      // --- Dependencies command ---
      output: { type: 'string' },
      verbose: { type: 'boolean' },
      'entry-file': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const command = positionals[0] as Command | undefined;

  // Parse port (string -> number)
  const portStr = values.port as string | undefined;
  const port = portStr ? parseInt(portStr, 10) : undefined;

  // Parse max-workers (string -> number)
  const maxWorkersStr = values['max-workers'] as string | undefined;
  const maxWorkers = maxWorkersStr ? parseInt(maxWorkersStr, 10) : undefined;

  // Handle --no-interactive (negation pattern)
  let interactive: boolean | undefined;
  if (values['no-interactive']) {
    interactive = false;
  } else if (values.interactive !== undefined) {
    interactive = values.interactive as boolean;
  }

  // Handle --reset-cache and --resetCache (both forms)
  const resetCache =
    (values['reset-cache'] as boolean) || (values.resetCache as boolean) || undefined;

  // Handle watch-folders (camelCase and kebab-case)
  const watchFoldersStr = (values.watchFolders as string) || (values['watch-folders'] as string);
  const watchFolders = watchFoldersStr ? parseCommaSeparated(watchFoldersStr) : undefined;

  // Handle source-exts (camelCase and kebab-case)
  const sourceExtsStr = (values.sourceExts as string) || (values['source-exts'] as string);
  const sourceExts = sourceExtsStr ? parseCommaSeparated(sourceExtsStr) : undefined;

  // Handle entry (--entry, --entry-file, or positional for build)
  const entry = (values.entry as string) || (values['entry-file'] as string) || undefined;

  // Handle bundle output (--out, --bundle-output, --outDir, --out-dir)
  const bundleOutput = (values['bundle-output'] as string) || (values.out as string) || undefined;
  const outDir = (values.outDir as string) || (values['out-dir'] as string) || undefined;

  return {
    command,
    help: (values.help as boolean) || false,
    version: (values.version as boolean) || false,

    // Common
    platform: values.platform as string | undefined,
    dev: values.dev as boolean | undefined,
    minify: values.minify as boolean | undefined,
    mode: values.mode as string | undefined,
    entry,
    config: values.config as string | undefined,
    root: values.root as string | undefined,
    bundler: values.bundler as string | undefined,
    maxWorkers: maxWorkers !== undefined && !isNaN(maxWorkers) ? maxWorkers : undefined,
    resetCache,
    interactive,

    // Server
    host: values.host as string | undefined,
    port: port !== undefined && !isNaN(port) && port >= 1 && port <= 65535 ? port : undefined,
    https: values.https as boolean | undefined,
    key: values.key as string | undefined,
    cert: values.cert as string | undefined,
    watchFolders,
    sourceExts,

    // Build
    outDir,
    bundleOutput,
    bundleEncoding: values['bundle-encoding'] as string | undefined,
    sourcemap: values['source-map'] as boolean | undefined,
    sourcemapOutput: values['sourcemap-output'] as string | undefined,
    sourcemapSourcesRoot: values['sourcemap-sources-root'] as string | undefined,
    sourcemapUseAbsolutePath: values['sourcemap-use-absolute-path'] as boolean | undefined,
    sourceMapUrl: values['source-map-url'] as string | undefined,
    assetsDest: values['assets-dest'] as string | undefined,
    assetCatalogDest: values['asset-catalog-dest'] as string | undefined,
    unstableTransformProfile: values['unstable-transform-profile'] as string | undefined,

    // Advanced
    transformOption: values['transform-option'] as string[] | undefined,
    resolverOption: values['resolver-option'] as string[] | undefined,

    // Dependencies
    output: values.output as string | undefined,
    verbose: values.verbose as boolean | undefined,
  };
}

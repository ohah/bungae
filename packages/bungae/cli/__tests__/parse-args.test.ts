import { describe, test, expect } from 'bun:test';

import { parseCliArgs, parseKeyValuePairs, parseCommaSeparated } from '../parse-args';

describe('parseCliArgs', () => {
  // =============================================
  // Command parsing
  // =============================================
  describe('command parsing', () => {
    test('should parse "build" command', () => {
      const result = parseCliArgs(['build']);
      expect(result.command).toBe('build');
    });

    test('should parse "serve" command', () => {
      const result = parseCliArgs(['serve']);
      expect(result.command).toBe('serve');
    });

    test('should parse "start" command (alias for serve)', () => {
      const result = parseCliArgs(['start']);
      expect(result.command).toBe('start');
    });

    test('should parse "dependencies" command', () => {
      const result = parseCliArgs(['dependencies']);
      expect(result.command).toBe('dependencies');
    });

    test('should return undefined command when no command given', () => {
      const result = parseCliArgs([]);
      expect(result.command).toBeUndefined();
    });
  });

  // =============================================
  // Meta options
  // =============================================
  describe('meta options', () => {
    test('should parse --help / -h', () => {
      expect(parseCliArgs(['--help']).help).toBe(true);
      expect(parseCliArgs(['-h']).help).toBe(true);
      expect(parseCliArgs(['build']).help).toBe(false);
    });

    test('should parse --version / -v', () => {
      expect(parseCliArgs(['--version']).version).toBe(true);
      expect(parseCliArgs(['-v']).version).toBe(true);
      expect(parseCliArgs(['build']).version).toBe(false);
    });
  });

  // =============================================
  // Common options
  // =============================================
  describe('common options', () => {
    test('should parse --platform / -p', () => {
      expect(parseCliArgs(['build', '--platform', 'ios']).platform).toBe('ios');
      expect(parseCliArgs(['build', '-p', 'android']).platform).toBe('android');
    });

    test('should parse --dev / -d', () => {
      expect(parseCliArgs(['build', '--dev']).dev).toBe(true);
      expect(parseCliArgs(['build', '-d']).dev).toBe(true);
      expect(parseCliArgs(['build']).dev).toBeUndefined();
    });

    test('should parse --minify / -m', () => {
      expect(parseCliArgs(['build', '--minify']).minify).toBe(true);
      expect(parseCliArgs(['build', '-m']).minify).toBe(true);
    });

    test('should parse --mode', () => {
      expect(parseCliArgs(['build', '--mode', 'production']).mode).toBe('production');
      expect(parseCliArgs(['build', '--mode', 'development']).mode).toBe('development');
      expect(parseCliArgs(['build', '--mode', 'release']).mode).toBe('release');
    });

    test('should parse --entry / -e', () => {
      expect(parseCliArgs(['build', '--entry', './src/index.ts']).entry).toBe('./src/index.ts');
      expect(parseCliArgs(['build', '-e', 'app.js']).entry).toBe('app.js');
    });

    test('should parse --entry-file (RN CLI compat)', () => {
      expect(parseCliArgs(['build', '--entry-file', './src/index.ts']).entry).toBe('./src/index.ts');
    });

    test('--entry takes priority over --entry-file', () => {
      const result = parseCliArgs(['build', '--entry', 'a.js', '--entry-file', 'b.js']);
      expect(result.entry).toBe('a.js');
    });

    test('should parse --config / -c', () => {
      expect(parseCliArgs(['build', '--config', './metro.config.js']).config).toBe('./metro.config.js');
      expect(parseCliArgs(['build', '-c', './bungae.config.ts']).config).toBe('./bungae.config.ts');
    });

    test('should parse --root', () => {
      expect(parseCliArgs(['build', '--root', '/app']).root).toBe('/app');
    });

    test('should parse --bundler', () => {
      expect(parseCliArgs(['build', '--bundler', 'oxc']).bundler).toBe('oxc');
      expect(parseCliArgs(['build', '--bundler', 'graph']).bundler).toBe('graph');
    });

    test('should parse --max-workers / -j', () => {
      expect(parseCliArgs(['build', '--max-workers', '4']).maxWorkers).toBe(4);
      expect(parseCliArgs(['build', '-j', '8']).maxWorkers).toBe(8);
    });

    test('should parse --reset-cache', () => {
      expect(parseCliArgs(['build', '--reset-cache']).resetCache).toBe(true);
    });

    test('should parse --resetCache (camelCase variant)', () => {
      expect(parseCliArgs(['build', '--resetCache']).resetCache).toBe(true);
    });
  });

  // =============================================
  // Server options (serve/start)
  // =============================================
  describe('server options', () => {
    test('should parse --host', () => {
      expect(parseCliArgs(['serve', '--host', '0.0.0.0']).host).toBe('0.0.0.0');
    });

    test('should parse --port', () => {
      expect(parseCliArgs(['serve', '--port', '8082']).port).toBe(8082);
    });

    test('should parse --https', () => {
      expect(parseCliArgs(['serve', '--https']).https).toBe(true);
    });

    test('should parse --key and --cert', () => {
      const result = parseCliArgs(['serve', '--key', './key.pem', '--cert', './cert.pem']);
      expect(result.key).toBe('./key.pem');
      expect(result.cert).toBe('./cert.pem');
    });

    test('should parse --no-interactive', () => {
      expect(parseCliArgs(['serve', '--no-interactive']).interactive).toBe(false);
    });

    test('should parse --interactive', () => {
      expect(parseCliArgs(['serve', '--interactive']).interactive).toBe(true);
    });

    test('should parse --watchFolders (comma-separated)', () => {
      const result = parseCliArgs(['serve', '--watchFolders', '../shared,../common']);
      expect(result.watchFolders).toEqual(['../shared', '../common']);
    });

    test('should parse --watch-folders (kebab-case)', () => {
      const result = parseCliArgs(['serve', '--watch-folders', '../lib']);
      expect(result.watchFolders).toEqual(['../lib']);
    });

    test('should parse --sourceExts (comma-separated)', () => {
      const result = parseCliArgs(['serve', '--sourceExts', 'ts,tsx,js,jsx']);
      expect(result.sourceExts).toEqual(['ts', 'tsx', 'js', 'jsx']);
    });

    test('should parse --source-exts (kebab-case)', () => {
      const result = parseCliArgs(['serve', '--source-exts', 'ts,tsx']);
      expect(result.sourceExts).toEqual(['ts', 'tsx']);
    });
  });

  // =============================================
  // Build options
  // =============================================
  describe('build options', () => {
    test('should parse --outDir / -o', () => {
      expect(parseCliArgs(['build', '--outDir', './dist']).outDir).toBe('./dist');
      expect(parseCliArgs(['build', '-o', './out']).outDir).toBe('./out');
    });

    test('should parse --out-dir (kebab-case)', () => {
      expect(parseCliArgs(['build', '--out-dir', './output']).outDir).toBe('./output');
    });

    test('should parse --bundle-output (RN CLI)', () => {
      expect(parseCliArgs(['build', '--bundle-output', './ios/main.jsbundle']).bundleOutput).toBe('./ios/main.jsbundle');
    });

    test('should parse --out / -O (Metro)', () => {
      expect(parseCliArgs(['build', '--out', './bundle.js']).bundleOutput).toBe('./bundle.js');
      expect(parseCliArgs(['build', '-O', './bundle.js']).bundleOutput).toBe('./bundle.js');
    });

    test('--bundle-output takes priority over --out', () => {
      const result = parseCliArgs(['build', '--bundle-output', 'a.js', '--out', 'b.js']);
      expect(result.bundleOutput).toBe('a.js');
    });

    test('should parse --bundle-encoding', () => {
      expect(parseCliArgs(['build', '--bundle-encoding', 'utf8']).bundleEncoding).toBe('utf8');
    });

    test('should parse --source-map', () => {
      expect(parseCliArgs(['build', '--source-map']).sourcemap).toBe(true);
    });

    test('should parse --source-map-url', () => {
      expect(parseCliArgs(['build', '--source-map-url', 'https://example.com/map']).sourceMapUrl).toBe('https://example.com/map');
    });

    test('should parse --sourcemap-output', () => {
      expect(parseCliArgs(['build', '--sourcemap-output', './dist/bundle.map']).sourcemapOutput).toBe('./dist/bundle.map');
    });

    test('should parse --sourcemap-sources-root', () => {
      expect(parseCliArgs(['build', '--sourcemap-sources-root', '/src']).sourcemapSourcesRoot).toBe('/src');
    });

    test('should parse --sourcemap-use-absolute-path', () => {
      expect(parseCliArgs(['build', '--sourcemap-use-absolute-path']).sourcemapUseAbsolutePath).toBe(true);
    });

    test('should parse --assets-dest', () => {
      expect(parseCliArgs(['build', '--assets-dest', './android/app/src/main/res']).assetsDest).toBe('./android/app/src/main/res');
    });

    test('should parse --asset-catalog-dest', () => {
      expect(parseCliArgs(['build', '--asset-catalog-dest', './ios/assets']).assetCatalogDest).toBe('./ios/assets');
    });

    test('should parse --unstable-transform-profile', () => {
      expect(parseCliArgs(['build', '--unstable-transform-profile', 'hermes-stable']).unstableTransformProfile).toBe('hermes-stable');
    });
  });

  // =============================================
  // Advanced options
  // =============================================
  describe('advanced options', () => {
    test('should parse --transform-option (repeatable)', () => {
      const result = parseCliArgs([
        'build',
        '--transform-option', 'foo=bar',
        '--transform-option', 'baz=qux',
      ]);
      expect(result.transformOption).toEqual(['foo=bar', 'baz=qux']);
    });

    test('should parse --resolver-option (repeatable)', () => {
      const result = parseCliArgs([
        'build',
        '--resolver-option', 'key1=val1',
        '--resolver-option', 'key2=val2',
      ]);
      expect(result.resolverOption).toEqual(['key1=val1', 'key2=val2']);
    });
  });

  // =============================================
  // Dependencies command options
  // =============================================
  describe('dependencies options', () => {
    test('should parse --output', () => {
      expect(parseCliArgs(['dependencies', '--output', './deps.txt']).output).toBe('./deps.txt');
    });

    test('should parse --verbose', () => {
      expect(parseCliArgs(['dependencies', '--verbose']).verbose).toBe(true);
    });

    test('should parse --entry-file for dependencies', () => {
      expect(parseCliArgs(['dependencies', '--entry-file', './src/index.ts']).entry).toBe('./src/index.ts');
    });
  });

  // =============================================
  // Complex scenarios
  // =============================================
  describe('complex scenarios', () => {
    test('Metro-style build command', () => {
      const result = parseCliArgs([
        'build',
        '--platform', 'ios',
        '--out', './dist/main.jsbundle',
        '--source-map',
        '--minify',
        '--max-workers', '4',
        '--config', './metro.config.js',
      ]);

      expect(result.command).toBe('build');
      expect(result.platform).toBe('ios');
      expect(result.bundleOutput).toBe('./dist/main.jsbundle');
      expect(result.sourcemap).toBe(true);
      expect(result.minify).toBe(true);
      expect(result.maxWorkers).toBe(4);
      expect(result.config).toBe('./metro.config.js');
    });

    test('RN CLI-style bundle command', () => {
      const result = parseCliArgs([
        'build',
        '--entry-file', './index.js',
        '--platform', 'android',
        '--dev',
        '--bundle-output', './android/app/build/bundle.js',
        '--sourcemap-output', './android/app/build/bundle.map',
        '--assets-dest', './android/app/src/main/res',
        '--reset-cache',
      ]);

      expect(result.command).toBe('build');
      expect(result.entry).toBe('./index.js');
      expect(result.platform).toBe('android');
      expect(result.dev).toBe(true);
      expect(result.bundleOutput).toBe('./android/app/build/bundle.js');
      expect(result.sourcemapOutput).toBe('./android/app/build/bundle.map');
      expect(result.assetsDest).toBe('./android/app/src/main/res');
      expect(result.resetCache).toBe(true);
    });

    test('Bungae-specific serve command', () => {
      const result = parseCliArgs([
        'serve',
        '--platform', 'ios',
        '--bundler', 'oxc',
        '--port', '9000',
        '--host', '0.0.0.0',
        '--no-interactive',
      ]);

      expect(result.command).toBe('serve');
      expect(result.platform).toBe('ios');
      expect(result.bundler).toBe('oxc');
      expect(result.port).toBe(9000);
      expect(result.host).toBe('0.0.0.0');
      expect(result.interactive).toBe(false);
    });

    test('HTTPS dev server', () => {
      const result = parseCliArgs([
        'serve',
        '--https',
        '--key', './certs/server.key',
        '--cert', './certs/server.crt',
        '--port', '8443',
      ]);

      expect(result.https).toBe(true);
      expect(result.key).toBe('./certs/server.key');
      expect(result.cert).toBe('./certs/server.crt');
      expect(result.port).toBe(8443);
    });

    test('Full release build', () => {
      const result = parseCliArgs([
        'build',
        '--platform', 'ios',
        '--mode', 'release',
        '--bundle-output', './ios/main.jsbundle',
        '--sourcemap-output', './ios/main.jsbundle.map',
        '--sourcemap-sources-root', '/src',
        '--sourcemap-use-absolute-path',
        '--assets-dest', './ios/assets',
        '--asset-catalog-dest', './ios/catalog',
        '--unstable-transform-profile', 'hermes-stable',
        '--reset-cache',
        '--max-workers', '8',
        '--transform-option', 'optimize=true',
        '--resolver-option', 'strict=true',
      ]);

      expect(result.command).toBe('build');
      expect(result.platform).toBe('ios');
      expect(result.mode).toBe('release');
      expect(result.bundleOutput).toBe('./ios/main.jsbundle');
      expect(result.sourcemapOutput).toBe('./ios/main.jsbundle.map');
      expect(result.sourcemapSourcesRoot).toBe('/src');
      expect(result.sourcemapUseAbsolutePath).toBe(true);
      expect(result.assetsDest).toBe('./ios/assets');
      expect(result.assetCatalogDest).toBe('./ios/catalog');
      expect(result.unstableTransformProfile).toBe('hermes-stable');
      expect(result.resetCache).toBe(true);
      expect(result.maxWorkers).toBe(8);
      expect(result.transformOption).toEqual(['optimize=true']);
      expect(result.resolverOption).toEqual(['strict=true']);
    });
  });

  // =============================================
  // Edge cases
  // =============================================
  describe('edge cases', () => {
    test('should handle invalid port gracefully', () => {
      const result = parseCliArgs(['serve', '--port', 'abc']);
      expect(result.port).toBeUndefined();
    });

    test('should handle invalid max-workers gracefully', () => {
      const result = parseCliArgs(['build', '--max-workers', 'xyz']);
      expect(result.maxWorkers).toBeUndefined();
    });

    test('should default help and version to false', () => {
      const result = parseCliArgs(['build']);
      expect(result.help).toBe(false);
      expect(result.version).toBe(false);
    });

    test('should handle empty watchFolders', () => {
      const result = parseCliArgs(['serve', '--watchFolders', '']);
      expect(result.watchFolders).toBeUndefined();
    });
  });
});

// =============================================
// Utility functions
// =============================================
describe('parseKeyValuePairs', () => {
  test('should parse key=value pairs', () => {
    expect(parseKeyValuePairs(['foo=bar', 'baz=qux'])).toEqual({
      foo: 'bar',
      baz: 'qux',
    });
  });

  test('should handle key without value', () => {
    expect(parseKeyValuePairs(['flag'])).toEqual({ flag: 'true' });
  });

  test('should handle value with = sign', () => {
    expect(parseKeyValuePairs(['key=a=b'])).toEqual({ key: 'a=b' });
  });

  test('should handle empty array', () => {
    expect(parseKeyValuePairs([])).toEqual({});
  });
});

describe('parseCommaSeparated', () => {
  test('should split comma-separated values', () => {
    expect(parseCommaSeparated('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('should trim whitespace', () => {
    expect(parseCommaSeparated(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  test('should filter empty values', () => {
    expect(parseCommaSeparated('a,,b,')).toEqual(['a', 'b']);
  });

  test('should handle single value', () => {
    expect(parseCommaSeparated('only')).toEqual(['only']);
  });

  test('should handle empty string', () => {
    expect(parseCommaSeparated('')).toEqual([]);
  });
});

/**
 * Minification utilities for production builds
 * Metro-compatible: Uses Terser by default with Metro-similar configuration
 *
 * Metro officially supports:
 * - terser (default, via metro-minify-terser)
 * - esbuild (via metro-minify-esbuild package)
 *
 * Bungae additionally supports:
 * - swc (Bungae-only, faster Rust-based minifier)
 * - bun (Bungae-only, Bun's built-in minifier)
 *
 * ⚠️ Important: Minification doesn't need to be identical to Metro
 * - Functionally equivalent results are sufficient
 * - Metro runtime functions (__d, __r, __DEV__, __METRO__) must be preserved
 * - Source maps must be compatible
 *
 * Terser options are similar to Metro (not necessarily identical):
 * - compress: { drop_console: false, drop_debugger: true, passes: 1, unsafe: false }
 * - mangle: { reserved: ['__d', '__r', '__DEV__', '__METRO__'], toplevel: false }
 * - format: { comments: false, ascii_only: false }
 */

export interface MinifyOptions {
  /** Minifier to use */
  minifier: 'bun' | 'terser' | 'esbuild' | 'swc';
  /** Source map to preserve */
  sourceMap?: string;
  /** File name for source map */
  fileName?: string;
}

export interface MinifyResult {
  code: string;
  map?: string;
}

/**
 * Minify code using the specified minifier
 */
export async function minifyCode(code: string, options: MinifyOptions): Promise<MinifyResult> {
  const { minifier, sourceMap, fileName = 'bundle.js' } = options;

  switch (minifier) {
    case 'bun':
      return minifyWithBun(code, sourceMap, fileName);
    case 'terser':
      return minifyWithTerser(code, sourceMap, fileName);
    case 'esbuild':
      return minifyWithEsbuild(code, sourceMap, fileName);
    case 'swc':
      return minifyWithSwc(code, sourceMap, fileName);
    default:
      throw new Error(`Unknown minifier: ${minifier}`);
  }
}

/**
 * Minify using Bun's built-in minifier
 */
async function minifyWithBun(
  code: string,
  sourceMap?: string,
  fileName?: string,
): Promise<MinifyResult> {
  // Use a unique temp file path to avoid collisions in high-concurrency scenarios
  const tempId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const tempFile = `/tmp/bungae-minify-${tempId}.js`;
  let tempFileCreated = false;

  try {
    // Bun has a built-in minifier via Bun.Transpiler
    // However, Bun.Transpiler doesn't support minification directly
    // Use Bun.build() for minification instead
    await Bun.write(tempFile, code);
    tempFileCreated = true;

    const result = await Bun.build({
      entrypoints: [tempFile],
      minify: {
        whitespace: true,
        syntax: true,
        identifiers: true,
      },
      sourcemap: sourceMap ? 'external' : 'none',
      outdir: '/tmp',
      naming: '[name].min.js',
    });

    if (!result.success || result.outputs.length === 0) {
      throw new Error('Bun minification failed');
    }

    // TypeScript doesn't know that outputs[0] exists after length check
    // We've already verified length > 0, so this is safe
    const firstOutput = result.outputs[0]!;
    const minifiedCode = await firstOutput.text();
    let minifiedMap: string | undefined;

    if (sourceMap && result.outputs.length > 1) {
      // Source map is in the second output
      const mapOutput = result.outputs.find((output) => output.path.endsWith('.map'));
      if (mapOutput) {
        minifiedMap = await mapOutput.text();
      }
    }

    return {
      code: minifiedCode,
      map: minifiedMap,
    };
  } catch (error) {
    // Fallback to Terser if Bun minification fails (Metro-compatible)
    console.warn('Bun minification failed, falling back to Terser (Metro-compatible):', error);
    return minifyWithTerser(code, sourceMap, fileName);
  } finally {
    // Always clean up temp file, even on error
    if (tempFileCreated) {
      try {
        await Bun.file(tempFile).unlink();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Minify using Terser
 */
async function minifyWithTerser(
  code: string,
  sourceMap?: string,
  fileName?: string,
): Promise<MinifyResult> {
  try {
    // Try to import terser (optional dependency)
    // @ts-expect-error - terser is optional dependency, types may not be available
    const terser = await import('terser').catch(() => null);
    if (!terser) {
      throw new Error('Terser is not installed. Install it with: bun add terser');
    }
    // Metro-compatible Terser configuration
    // Metro uses default Terser options with some Metro-specific reserved names
    // Reference: Metro's default minifier config (metro-minify-terser)
    const result = await terser.minify(code, {
      compress: {
        // Metro-compatible: Keep console by default (useful for React Native debugging)
        drop_console: false,
        drop_debugger: true,
        // Metro-compatible: Use default passes (1) to match Metro exactly
        passes: 1,
        // Metro-compatible: Keep unsafe optimizations disabled by default
        unsafe: false,
        unsafe_comps: false,
        unsafe_math: false,
        unsafe_methods: false,
        unsafe_proto: false,
        unsafe_regexp: false,
        unsafe_undefined: false,
      },
      mangle: {
        // Metro-compatible: Reserve Metro runtime functions
        reserved: [
          '__d', // Metro module definition
          '__r', // Metro module require
          '__DEV__', // React Native dev flag
          '__METRO__', // Metro identifier
          '__BUNGAE__', // Bungae identifier
          '__BUNGAE_BUNDLER__', // Bungae bundler identifier
          '__BUNGAE_VERSION__', // Bungae version identifier
        ],
        keep_classnames: false,
        keep_fnames: false,
        // Metro-compatible: Don't mangle top-level by default
        toplevel: false,
      },
      format: {
        comments: false,
        // Metro-compatible: Preserve ASCII
        ascii_only: false,
      },
      sourceMap: sourceMap
        ? {
            content: sourceMap,
            filename: fileName,
            url: `${fileName}.map`,
          }
        : false,
    });

    if (!result.code) {
      throw new Error('Terser minification returned empty code');
    }

    return {
      code: result.code,
      map: result.map
        ? typeof result.map === 'string'
          ? result.map
          : JSON.stringify(result.map)
        : undefined,
    };
  } catch (error) {
    // If terser is not available, try esbuild
    if (error instanceof Error && error.message.includes('not installed')) {
      console.warn('Terser is not installed. Install it with: bun add terser');
    } else {
      console.warn('Terser minification failed, falling back to esbuild:', error);
    }
    return minifyWithEsbuild(code, sourceMap, fileName);
  }
}

/**
 * Minify using esbuild
 */
async function minifyWithEsbuild(
  code: string,
  sourceMap?: string,
  fileName?: string,
): Promise<MinifyResult> {
  try {
    // @ts-expect-error - esbuild is optional dependency, types may not be available
    const esbuild = await import('esbuild');
    const result = await esbuild.transform(code, {
      minify: true,
      sourcemap: sourceMap ? 'external' : false,
      sourcefile: fileName,
      target: 'es2015',
      format: 'cjs',
      // Note: esbuild doesn't provide explicit reserved names option like Terser.
      // In practice, esbuild's minifier doesn't mangle global function names like __d, __r,
      // but this behavior is not guaranteed. For guaranteed Metro compatibility, use Terser.
      keepNames: false,
      legalComments: 'none',
    });

    return {
      code: result.code,
      map: result.map
        ? typeof result.map === 'string'
          ? result.map
          : JSON.stringify(result.map)
        : undefined,
    };
  } catch (error) {
    // If esbuild is not available, try swc
    console.warn('esbuild minification failed, falling back to swc:', error);
    return minifyWithSwc(code, sourceMap, fileName);
  }
}

/**
 * Minify using SWC
 */
async function minifyWithSwc(
  code: string,
  sourceMap?: string,
  fileName?: string,
): Promise<MinifyResult> {
  try {
    const swc = await import('@swc/core');
    const result = await swc.transform(code, {
      jsc: {
        minify: {
          compress: {
            drop_console: false, // Keep console (Metro-compatible)
            drop_debugger: true,
          },
          mangle: {
            // SWC doesn't support a Terser-style "reserved" list for mangling.
            // To reliably preserve Metro runtime functions (__d, __r, __DEV__, __METRO__, __BUNGAE__),
            // we keep all function and class names (less aggressive, but Metro-compatible).
            keep_classnames: true,
            keep_fnames: true,
          },
        },
        target: 'es2015',
        parser: {
          syntax: 'ecmascript',
          jsx: false, // Already transformed by Babel
        },
      },
      minify: true,
      sourceMaps: sourceMap ? true : false,
      sourceFileName: fileName,
    });

    return {
      code: result.code,
      map: result.map
        ? typeof result.map === 'string'
          ? result.map
          : JSON.stringify(result.map)
        : undefined,
    };
  } catch (error) {
    // If all minifiers fail, return original code
    console.error('All minifiers failed, returning original code:', error);
    return {
      code,
      map: sourceMap,
    };
  }
}

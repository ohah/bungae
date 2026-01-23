/**
 * Code transformation for Graph Bundler
 * Uses Babel with @react-native/babel-preset (Metro-compatible)
 */

import { existsSync } from 'fs';
import { extname, join } from 'path';

import type { ResolvedConfig } from '../../config/types';

/**
 * Transform a single file using Babel (Metro-compatible)
 * Uses Hermes parser for Flow, Babel for all transformations
 */
export async function transformFile(
  filePath: string,
  code: string,
  config: ResolvedConfig,
  entryPath?: string,
): Promise<{ ast: any } | null> {
  const { platform, dev } = config;

  // Skip Flow files and asset files
  if (filePath.endsWith('.flow.js') || filePath.endsWith('.flow')) {
    return null;
  }

  // JSON files: Export as module (no AST transformation needed)
  const isJSON = filePath.endsWith('.json');
  if (isJSON) {
    // Wrap JSON as CommonJS module - create simple AST
    const babel = await import('@babel/core');
    const ast = await babel.parseAsync(`module.exports = ${code};`, {
      filename: filePath,
      sourceType: 'module',
    });
    return { ast };
  }

  // Use Babel for all transformations (Metro-compatible)
  // Note: Asset files are handled in processModule before reaching here
  return transformWithBabel(code, filePath, {
    dev,
    platform,
    root: config.root,
    entryPath,
  });
}

/**
 * Transform code using Babel with @react-native/babel-preset (Metro-compatible)
 * Uses the same preset that Metro uses for full compatibility
 * Reads babel.config.js from project root and merges with default settings (Metro-compatible)
 */
export async function transformWithBabel(
  code: string,
  filePath: string,
  options: { dev: boolean; platform: string; root: string; entryPath?: string },
): Promise<{ ast: any }> {
  const babel = await import('@babel/core');
  const hermesParser = await import('hermes-parser');

  // Metro uses transformFromAstSync: parse AST first, then transform
  // Metro behavior: hermesParser option determines parser (Hermes or Babel)
  // We use Hermes parser by default (like Metro with hermesParser: true)
  // This handles Flow syntax including "import typeof" correctly
  const OLD_BABEL_ENV = process.env.BABEL_ENV;
  process.env.BABEL_ENV = options.dev ? 'development' : process.env.BABEL_ENV || 'production';

  try {
    // Load babel.config.js directly and resolve module: prefix presets
    // This ensures presets are loaded correctly in Bun environment
    let loadedPresets: any[] = [];
    let loadedPlugins: any[] = [];

    const babelConfigPath = join(options.root, 'babel.config.js');
    if (existsSync(babelConfigPath)) {
      try {
        // Use createRequire for Bun compatibility
        const { createRequire } = await import('module');
        const projectRequire = createRequire(join(options.root, 'package.json'));

        // Clear require cache to ensure fresh load (if using Node.js require)
        try {
          const cacheKey = projectRequire.resolve(babelConfigPath);
          if (projectRequire.cache && projectRequire.cache[cacheKey]) {
            delete projectRequire.cache[cacheKey];
          }
        } catch {
          // Ignore cache clearing errors
        }

        // Load babel.config.js using projectRequire
        const babelConfigModule = projectRequire(babelConfigPath);
        const userConfig =
          typeof babelConfigModule === 'function'
            ? babelConfigModule(process.env)
            : babelConfigModule.default || babelConfigModule;

        // Resolve module: prefix presets to actual paths
        if (userConfig.presets) {
          loadedPresets = userConfig.presets.map((preset: any) => {
            if (typeof preset === 'string') {
              // Handle module: prefix (e.g., "module:@react-native/babel-preset")
              if (preset.startsWith('module:')) {
                const moduleName = preset.replace('module:', '');
                try {
                  // Resolve the actual preset path
                  const presetPath = projectRequire.resolve(moduleName);
                  return presetPath;
                } catch (error) {
                  console.warn(`Failed to resolve preset ${preset}:`, error);
                  return preset; // Fallback to original string
                }
              }
              return preset;
            } else if (Array.isArray(preset)) {
              // Preset with options: [preset, options]
              const [presetName, options] = preset;
              if (typeof presetName === 'string' && presetName.startsWith('module:')) {
                const moduleName = presetName.replace('module:', '');
                try {
                  const presetPath = projectRequire.resolve(moduleName);
                  return [presetPath, options];
                } catch (error) {
                  console.warn(`Failed to resolve preset ${presetName}:`, error);
                  return preset; // Fallback to original
                }
              }
              return preset;
            }
            return preset;
          });
        }

        // Load plugins if any
        if (userConfig.plugins) {
          loadedPlugins = userConfig.plugins;
        }
      } catch (error) {
        console.warn(`Failed to load babel.config.js:`, error);
      }
    }

    // Metro-style babel config (matches reference/metro/packages/metro-babel-transformer/src/index.js)
    // Metro sets code: false to return AST only (serializer generates code)
    const babelConfig: any = {
      ast: true,
      // Disable auto-discovery since we're loading config manually
      babelrc: false,
      configFile: false,
      // Use presets and plugins from babel.config.js (manually loaded)
      presets: loadedPresets.length > 0 ? loadedPresets : undefined,
      caller: {
        bundler: 'metro',
        name: 'metro',
        platform: options.platform,
        // Metro includes these additional caller options for @react-native/babel-preset
        isDev: options.dev,
        isServer: false,
        // Engine can be 'hermes' or 'jsc' - default to 'hermes' for React Native
        engine: 'hermes',
      },
      cloneInputAst: false, // Metro sets this to avoid cloning overhead
      code: false, // Metro-compatible: return AST only, serializer generates code
      cwd: options.root, // Metro sets cwd to projectRoot
      filename: filePath,
      highlightCode: true,
      sourceType: 'module',
      // Merge user plugins with our custom plugins
      plugins: [
        ...(loadedPlugins || []),
        [
          require.resolve('babel-plugin-transform-define'),
          {
            'Platform.OS': options.platform, // Don't use JSON.stringify - babel-plugin-transform-define handles it
            'process.env.NODE_ENV': JSON.stringify(options.dev ? 'development' : 'production'),
          },
        ],
        // Override @babel/plugin-transform-object-rest-spread to use loose mode
        // This makes it use Object.assign instead of helper functions, matching Metro's behavior
        // Adding this plugin here will override the same plugin from @react-native/babel-preset
        [
          require.resolve('@babel/plugin-transform-object-rest-spread'),
          {
            loose: true,
            useBuiltIns: true,
          },
        ],
      ],
    };

    // Metro: Parse with Hermes parser (hermesParser: true) or Babel parser (hermesParser: false)
    // Select parser based on file extension (Metro-compatible):
    // - TypeScript files (.ts, .tsx) → Babel parser (TypeScript support)
    // - JavaScript/Flow files (.js, .jsx, .flow) → Hermes parser (Flow support including "import typeof")
    const fileExt = extname(filePath).toLowerCase();
    const useHermesParser = !fileExt.endsWith('.ts') && !fileExt.endsWith('.tsx');

    const sourceAst = useHermesParser
      ? hermesParser.parse(code, {
          babel: true,
          sourceType: babelConfig.sourceType,
        })
      : await babel.parseAsync(code, {
          filename: filePath,
          sourceType: babelConfig.sourceType,
          parserOpts: {
            // TypeScript files: use typescript plugin only (not flow)
            // JavaScript files: use jsx plugin only (flow handled by Hermes parser)
            plugins:
              fileExt.endsWith('.tsx') || fileExt.endsWith('.ts') ? ['jsx', 'typescript'] : ['jsx'],
          },
        });

    // Debug: Check if presets were loaded (in dev mode for important files)
    // Check for: entry file, JSX/TSX files, or react-native files
    const isEntryFile = options.entryPath && filePath === options.entryPath;
    const isJSXFile = fileExt.endsWith('.jsx') || fileExt.endsWith('.tsx');
    const isReactNativeFile = filePath.includes('node_modules/react-native');
    const shouldCheckPreset = options.dev && (isEntryFile || isJSXFile || isReactNativeFile);

    // Only warn if no presets were loaded (successful case is silent)
    if (shouldCheckPreset && (!loadedPresets || loadedPresets.length === 0)) {
      const fileType = isEntryFile ? 'entry' : isJSXFile ? 'JSX' : 'react-native';
      console.warn(
        `WARNING: Babel did not load any presets for ${fileType} file ${filePath}. JSX and event handlers may not work correctly.`,
      );
    }

    const transformResult = await babel.transformFromAstAsync(sourceAst, code, babelConfig);

    if (!transformResult?.ast) {
      // Type-only files may result in empty AST - create empty module AST
      // Create File node (Metro-compatible) with Program inside
      const emptyProgram = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'module' },
                property: { type: 'Identifier', name: 'exports' },
              },
              right: { type: 'ObjectExpression', properties: [] },
            },
          },
        ],
        directives: [],
        sourceType: 'module',
      };
      const emptyAst = {
        type: 'File',
        program: emptyProgram,
        comments: [],
        tokens: [],
      };
      return { ast: emptyAst };
    }

    // Metro-compatible: return AST only (no code generation)
    // Dependencies will be extracted from AST directly
    return { ast: transformResult.ast };
  } finally {
    if (OLD_BABEL_ENV) {
      process.env.BABEL_ENV = OLD_BABEL_ENV;
    }
  }
}

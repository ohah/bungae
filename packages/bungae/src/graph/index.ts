/**
 * Dependency Graph - Builds dependency graph from entry point
 */

import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { tmpdir } from 'os';

import { getPrependedModules } from '../serializer';
import type { Module as SerializerModule } from '../serializer/types';
import { transform } from '../transformer';
import { extractDependencies } from '../transformer/utils';
import { createPlatformResolverPlugin } from '../resolver/platform-plugin';
import type { GraphBuildOptions, GraphBuildResult, GraphModule } from './types';

/**
 * Resolve module path with platform-specific extensions
 */
async function resolveModule(
  fromPath: string,
  moduleSpecifier: string,
  options: GraphBuildOptions,
): Promise<string | null> {
  const fromDir = dirname(fromPath);
  const { platform, resolver } = options;

  // Handle relative paths
  if (moduleSpecifier.startsWith('.')) {
    const basePath = resolve(fromDir, moduleSpecifier);

    // Build extension priority list
    const extensions: string[] = [];

    // 1. Platform-specific extensions
    if (platform !== 'web') {
      for (const ext of resolver.sourceExts) {
        extensions.push(`.${platform}${ext}`);
      }
    }

    // 2. Native extensions (if preferNativePlatform)
    if (resolver.preferNativePlatform && platform !== 'web') {
      for (const ext of resolver.sourceExts) {
        extensions.push(`.native${ext}`);
      }
    }

    // 3. Default extensions
    for (const ext of resolver.sourceExts) {
      extensions.push(ext);
    }

    // Try each extension
    for (const ext of extensions) {
      const candidate = `${basePath}${ext}`;
      if (
        existsSync(candidate) &&
        !candidate.endsWith('.flow.js') &&
        !candidate.endsWith('.flow')
      ) {
        return candidate;
      }
    }

    // Try without extension (if it's already a file)
    if (existsSync(basePath)) {
      return basePath;
    }
    
    // Try with .js extension explicitly (some files might not have extension in path)
    if (existsSync(`${basePath}.js`)) {
      return `${basePath}.js`;
    }

    return null;
  }

  // Handle node_modules - use Bun's built-in resolution via require.resolve
  try {
    // Use require.resolve to leverage Node.js/Bun's module resolution
    // This handles package.json exports, main, module fields, etc.
    let resolved = require.resolve(moduleSpecifier, {
      paths: [
        fromDir,
        options.projectRoot,
        resolve(options.projectRoot, 'node_modules'),
        ...resolver.nodeModulesPaths.map((p) => resolve(options.projectRoot, p)),
      ],
    });

    // If resolved to a Flow file, try to find the non-Flow version
    if (resolved.endsWith('.flow.js') || resolved.endsWith('.flow')) {
      // Try without .flow extension
      const withoutFlow = resolved.replace(/\.flow(\.js)?$/, '.js');
      if (existsSync(withoutFlow)) {
        resolved = withoutFlow;
      } else {
        // Skip Flow files
        return null;
      }
    }

    return resolved;
  } catch {
    // If require.resolve fails, try manual lookup
    const nodeModulesPaths = [
      resolve(options.projectRoot, 'node_modules'),
      ...resolver.nodeModulesPaths.map((p) => resolve(options.projectRoot, p)),
    ];

    for (const nodeModulesPath of nodeModulesPaths) {
      const packagePath = resolve(nodeModulesPath, moduleSpecifier);
      // Try package.json main field, index.js, etc.
      const extensions = resolver.sourceExts;
      for (const ext of extensions) {
        const withExt = `${packagePath}${ext.startsWith('.') ? '' : '.'}${ext}`;
        if (existsSync(withExt)) {
          return withExt;
        }
      }
      // Try packagePath/index.js
      const indexPath = resolve(packagePath, `index${extensions[0]}`);
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }
  }

  return null;
}

/**
 * Build dependency graph from entry point
 */
export async function buildGraph(options: GraphBuildOptions): Promise<GraphBuildResult> {
  const { entryFile, projectRoot, platform, dev, onProgress } = options;
  
  // Validate required options
  if (!entryFile) {
    throw new Error('entryFile is required');
  }
  if (!projectRoot) {
    throw new Error('projectRoot is required');
  }

  // Resolve entry file to absolute path
  const entryPath = resolve(projectRoot, entryFile);
  if (!existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  const modules = new Map<string, GraphModule>();
  const visited = new Set<string>();
  const processing = new Set<string>(); // For cycle detection

  let processedCount = 0;
  let totalCount = 0;

  /**
   * Process a module (transform and collect dependencies)
   */
  async function processModule(filePath: string): Promise<GraphModule> {
    // Return cached module first (already fully processed)
    if (modules.has(filePath)) {
      return modules.get(filePath)!;
    }

    // Check for cycles - if already processing, it's a circular dependency
    if (processing.has(filePath)) {
      throw new Error(`Circular dependency detected: ${filePath}`);
    }

    // Mark as processing
    processing.add(filePath);

    // Skip Flow type files
    if (filePath.endsWith('.flow.js') || filePath.endsWith('.flow')) {
      // Return empty module for Flow files
      const module: GraphModule = {
        path: filePath,
        code: '',
        dependencies: [],
        originalDependencies: [],
        processed: true,
      };
      modules.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);
      return module;
    }

    // Skip asset files (images, etc.) and JSON files
    const { assetExts } = options.resolver;
    const isAsset = assetExts.some((ext) => filePath.endsWith(ext));
    const isJSON = filePath.endsWith('.json');
    if (isAsset || isJSON) {
      // Return empty module for asset/JSON files
      // These should be handled separately (not transformed)
      const module: GraphModule = {
        path: filePath,
        code: '',
        dependencies: [],
        originalDependencies: [],
        processed: true,
      };
      modules.set(filePath, module);
      visited.add(filePath);
      processing.delete(filePath);
      return module;
    }

    // Read file
    const code = readFileSync(filePath, 'utf-8');

    // Step 1: Remove type assertions with oxc BEFORE Bun.build()
    // This ensures Bun.build() receives clean code without type assertions
    let preprocessedCode = code;
    const { removeTypeAssertionsWithOxc } = await import('../transformer/oxc-transformer');
    try {
      const oxcResult = await removeTypeAssertionsWithOxc(code, {
        filePath,
        code,
        platform,
        dev,
        projectRoot,
      });
      preprocessedCode = oxcResult.code;
      
      // Verify type assertions were removed (for debugging)
      if (preprocessedCode.includes(' as ') && code.includes(' as ')) {
        // Type assertions still present, try regex fallback
        preprocessedCode = preprocessedCode.replace(/\}\s+as\s+[\w.]+;/gm, '};');
        preprocessedCode = preprocessedCode.replace(/\)\s+as\s+[\w.]+;/gm, ');');
        preprocessedCode = preprocessedCode.replace(/\s+as\s+[\w.]+(?=\s*[;,)])/gm, '');
      }
    } catch (error) {
      // If oxc fails, use regex fallback
      if (code.includes(' as ')) {
        preprocessedCode = code.replace(/\}\s+as\s+[\w.]+;/gm, '};');
        preprocessedCode = preprocessedCode.replace(/\)\s+as\s+[\w.]+;/gm, ');');
        preprocessedCode = preprocessedCode.replace(/\s+as\s+[\w.]+(?=\s*[;,)])/gm, '');
      } else {
        preprocessedCode = code;
      }
    }

    // Step 2: Transform using SWC for ESM → CJS conversion
    // SWC handles:
    // - ESM → CJS conversion (module.type: 'commonjs')
    // - TypeScript/JSX transformation
    // - Fast Rust-based transformation
    let transformedCode = '';
    try {
      // Always use SWC for transformation if code has ESM syntax
      // Check if code has ESM imports/exports that need conversion
      // Match import/export statements anywhere in the code (not just at the start)
      // Use multiline flag to match across lines
      const hasESM = /import\s+.*\s+from\s+['"]|export\s+.*\s+from\s+['"]|^import\s|^export\s|import\s*\(/m.test(preprocessedCode);
      
      // Always try SWC transformation if ESM syntax is detected
      // SWC will handle both ESM and non-ESM code
      if (hasESM) {
        // Force SWC to treat this as a module and convert ESM to CJS
        // Use SWC to transform ESM to CJS
        const swc = await import('@swc/core');
        const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
        const isJSX = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
        
        const swcResult = await swc.transform(preprocessedCode, {
          filename: filePath,
          jsc: {
            parser: {
              syntax: isTS ? 'typescript' : 'ecmascript',
              tsx: isJSX,
              decorators: false,
              dynamicImport: true,
            },
            target: 'es2015',
            keepClassNames: true,
            transform: {
              react: {
                runtime: 'automatic',
                development: dev,
              },
            },
          },
          module: {
            type: 'commonjs', // ✅ ESM → CJS conversion
            strict: false, // Add __esModule flag for interop
            strictMode: false, // Don't add 'use strict'
            lazy: false,
            noInterop: false,
          },
          isModule: true, // Explicitly mark as module to ensure ESM transformation
          sourceMaps: false, // We don't need source maps for individual modules
          configFile: false, // Don't use .swcrc config file
          swcrc: false, // Don't use .swcrc config file
        });
        
        transformedCode = swcResult.code;
        
        // Verify SWC converted imports to require
        // If import statements still remain, try to convert them manually
        // This handles edge cases where SWC might not convert certain import patterns
        if (transformedCode.includes('import ') || transformedCode.includes('import{')) {
          // SWC didn't convert some imports - manually convert remaining imports
          // Handle: import X, { Y } from "module"
          transformedCode = transformedCode.replace(
            /\bimport\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*/g,
            (match, defaultImport, namedImports, modulePath) => {
              // Remove type-only imports from namedImports
              const cleanedNamedImports = namedImports
                .split(',')
                .map((imp: string) => imp.trim())
                .filter((imp: string) => !imp.startsWith('type ') && !imp.startsWith('typeof '))
                .join(', ');
              if (cleanedNamedImports) {
                return `const ${defaultImport} = require("${modulePath}"); const {${cleanedNamedImports}} = require("${modulePath}");`;
              } else {
                return `const ${defaultImport} = require("${modulePath}");`;
              }
            },
          );
          // Handle: import X from "module"
          transformedCode = transformedCode.replace(
            /\bimport\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*/g,
            'const $1 = require("$2");',
          );
          // Handle: import { X, Y } from "module"
          transformedCode = transformedCode.replace(
            /\bimport\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*/g,
            'const {$1} = require("$2");',
          );
          // Handle: import * as X from "module"
          transformedCode = transformedCode.replace(
            /\bimport\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*/g,
            'const $1 = require("$2");',
          );
          // Handle: import * from "module"
          transformedCode = transformedCode.replace(
            /\bimport\s+\*\s+from\s+['"]([^'"]+)['"];?\s*/g,
            'require("$1");',
          );
          // Handle: import "module"
          transformedCode = transformedCode.replace(
            /\bimport\s+['"]([^'"]+)['"];?\s*/g,
            'require("$1");',
          );
          // Remove type-only imports
          transformedCode = transformedCode.replace(
            /\bimport\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*/g,
            '',
          );
          transformedCode = transformedCode.replace(
            /\bimport\s+type\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*/g,
            '',
          );
        }
      } else {
        // No ESM syntax, use Bun.Transpiler for TypeScript/JSX transformation
        const transformResult = await transform(
          {
            filePath,
            code: preprocessedCode,
            platform,
            dev,
            projectRoot,
          },
          options.transformer,
        );
        transformedCode = transformResult.code;
      }
      
      // Remove type assertions (SWC might not remove all)
      if (transformedCode.includes(' as ')) {
        transformedCode = transformedCode.replace(/\}\s*\n?\s*as\s+[\w.]+;/gm, '};');
        transformedCode = transformedCode.replace(/\)\s*\n?\s*as\s+[\w.]+;/gm, ');');
        transformedCode = transformedCode.replace(/\}\s+as\s+[\w.]+;/g, '};');
        transformedCode = transformedCode.replace(/\)\s+as\s+[\w.]+;/g, ');');
        transformedCode = transformedCode.replace(/\s+as\s+[\w.]+(?=\s*[;,)])/g, '');
      }
    } catch (error) {
      // If SWC fails, fallback to original transform function
      console.warn(`[bungae] SWC transformation failed for ${filePath}, using fallback:`, error);
      const transformResult = await transform(
        {
          filePath,
          code: preprocessedCode,
          platform,
          dev,
          projectRoot,
        },
        options.transformer,
      );
      transformedCode = transformResult.code;
    }

    // Extract dependencies from original code (before transformation)
    // Use AST-based extraction with oxc for accurate dependency detection
    // For JSX files, oxc-transform is used to transform JSX first, then extract dependencies
    const dependencies = await extractDependencies(code, filePath);

    // Create transform result
    const transformResult = {
      code: transformedCode,
      dependencies,
      map: undefined, // TODO: Extract source map from Bun.build() result
    };

    // Resolve dependencies
    const resolvedDependencies: string[] = [];
    const originalDependencies: string[] = [];
    for (const dep of transformResult.dependencies) {
      // Skip empty or invalid dependencies
      if (!dep || !dep.trim()) {
        continue;
      }
      
      const resolved = await resolveModule(filePath, dep, options);
      if (resolved) {
        // Always add to dependencies, even if already visited
        // This ensures the dependency is included in the module's dependencyMap
        resolvedDependencies.push(resolved);
        originalDependencies.push(dep); // Keep original path for require conversion
        
        // Process dependency if not already visited
        if (!visited.has(resolved)) {
          // Will be processed recursively below
        }
      } else if (options.dev) {
        // In dev mode, warn about unresolved dependencies
        // This helps identify missing modules
        console.warn(
          `[bungae] Failed to resolve dependency "${dep}" from ${filePath}`,
        );
      }
    }

    // Create module
    const module: GraphModule = {
      path: filePath,
      code: transformResult.code,
      map: transformResult.map,
      dependencies: resolvedDependencies,
      originalDependencies: originalDependencies,
      processed: true,
    };

    modules.set(filePath, module);
    visited.add(filePath);

    processedCount++;
    totalCount = Math.max(totalCount, modules.size + resolvedDependencies.length);
    onProgress?.(processedCount, totalCount);

    // Process dependencies recursively
    // Metro processes all dependencies, even if already visited
    // This ensures all transitive dependencies are included
    // IMPORTANT: Keep processing flag set while processing dependencies to detect cycles
    for (const dep of resolvedDependencies) {
      // Check for circular dependency BEFORE checking visited
      // This ensures we detect cycles even if the module is being processed
      if (processing.has(dep)) {
        processing.delete(filePath); // Clean up before throwing
        throw new Error(`Circular dependency detected: ${dep} (from ${filePath})`);
      }
      
      // Process dependency if not already visited
      // Metro does this to ensure all dependencies are included
      if (!visited.has(dep)) {
        await processModule(dep);
      }
      // Note: Even if already visited, the dependency is still in the dependencyMap
      // This is correct behavior - Metro includes all dependencies in dependencyMap
    }

    // Remove from processing set AFTER all dependencies are processed
    // This ensures we can detect cycles during dependency processing
    processing.delete(filePath);

    return module;
  }

  // Process entry module
  const entryModule = await processModule(entryPath);

  // Metro automatically includes InitializeCore in React Native projects
  // InitializeCore is required to run before the entry point
  // Try to find and include InitializeCore if it's not already in the graph
  // This ensures InitializeCore and its dependencies are included
  try {
    const initializeCorePath = require.resolve('react-native/Libraries/Core/InitializeCore', {
      paths: [projectRoot],
    });
    
    // Check if InitializeCore is already in the graph
    if (!modules.has(initializeCorePath)) {
      // InitializeCore is not in the graph, add it and process its dependencies
      await processModule(initializeCorePath);
    }
  } catch {
    // InitializeCore not found, skip (might not be a React Native project)
    // This is fine - non-React Native projects don't need InitializeCore
  }

  // Get prepended modules (prelude, metro-runtime, polyfills)
  // Metro uses empty string for globalPrefix to maintain compatibility
  const prepend: SerializerModule[] = getPrependedModules({
    dev,
    globalPrefix: '',
    polyfills: [], // TODO: Add polyfills from config
  });

  return {
    modules,
    entryModule,
    prepend,
  };
}

/**
 * Convert graph modules to serializer modules
 */
export function graphModulesToSerializerModules(
  graphModules: Map<string, GraphModule>,
): SerializerModule[] {
  return Array.from(graphModules.values()).map((module) => ({
    path: module.path,
    code: module.code,
    dependencies: module.dependencies,
    originalDependencies: module.originalDependencies,
    map: module.map,
  }));
}

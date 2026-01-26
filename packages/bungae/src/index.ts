/**
 * Bungae - A lightning-fast React Native bundler powered by Bun
 *
 * @packageDocumentation
 */

import {
  loadConfig,
  resolveConfig,
  getDefaultConfig,
  mergeConfig,
  defineConfig,
  DEFAULT_RESOLVER,
  DEFAULT_TRANSFORMER,
  DEFAULT_SERIALIZER,
} from './config';
// Import everything first, then export in a single block to avoid duplicate exports
import type {
  BungaeConfig,
  ResolvedConfig,
  ResolverConfig,
  TransformerConfig,
  SerializerConfig,
  Platform,
  Mode,
  BundleType,
} from './config/types';
import { buildGraph, graphModulesToSerializerModules } from './graph';
import type { GraphBuildOptions, GraphBuildResult, GraphModule } from './graph/types';
import { createPlatformResolverPlugin } from './resolver';
import type { PlatformResolverOptions } from './resolver';
import {
  baseJSBundle,
  getPrependedModules,
  createModuleIdFactory,
  getRunModuleStatement,
} from './serializer';
import type { Module, Bundle, SerializerOptions } from './serializer';
import { transform } from './transformer';
import type { TransformOptions, TransformResult } from './transformer';

// Export VERSION constant
export const VERSION = '0.0.1';

// Export all in a single block to prevent duplicate exports during bundling
export type {
  BungaeConfig,
  ResolvedConfig,
  ResolverConfig,
  TransformerConfig,
  SerializerConfig,
  Platform,
  Mode,
  BundleType,
  PlatformResolverOptions,
  TransformOptions,
  TransformResult,
  Module,
  Bundle,
  SerializerOptions,
  GraphBuildOptions,
  GraphBuildResult,
  GraphModule,
};

export {
  loadConfig,
  resolveConfig,
  getDefaultConfig,
  mergeConfig,
  defineConfig,
  DEFAULT_RESOLVER,
  DEFAULT_TRANSFORMER,
  DEFAULT_SERIALIZER,
  createPlatformResolverPlugin,
  transform,
  baseJSBundle,
  getPrependedModules,
  createModuleIdFactory,
  getRunModuleStatement,
  buildGraph,
  graphModulesToSerializerModules,
};

// Export build and serve separately to avoid bunup duplicate export issues
export { build } from './build';
export { serve } from './serve';

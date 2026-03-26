/**
 * ZTS Bundler - Zig NAPI-based React Native Bundler (v3)
 *
 * Uses ZTS native addon for high-performance bundling.
 * All parsing, transformation, and bundling is done in Zig via NAPI.
 * JS layer handles RN ecosystem integration (config, Babel fallback, DevTools).
 */

export { buildWithZts } from './bundler';
export { serveWithZts } from './server';
export type {
  ZtsBuildResult,
  ZtsBuildOptions,
  AssetData,
  ZtsNativeBinding,
  ZtsNativeBundleOptions,
  ZtsNativeBundleResult,
  ZtsNativePatchResult,
} from './types';

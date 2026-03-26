/**
 * Re-export shared polyfill resolution for ZTS bundler.
 * Uses rn-get-polyfills (same as oxc-bundler) with caching.
 */
export { resolvePolyfillPaths } from '../oxc-bundler/polyfills';

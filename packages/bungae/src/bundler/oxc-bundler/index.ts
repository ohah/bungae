/**
 * OXC Bundler - Rolldown-based React Native Bundler (v2)
 *
 * Uses OXC/Rolldown with strictExecutionOrder for ESM module execution order.
 * Supports Hermes bytecode precompilation.
 */

export { buildWithOxc } from './bundler';
export type { OxcBuildResult, OxcBuildOptions, AssetData, HermesCompileResult } from './types';
export { compileToHermesBytecode } from './hermes/compiler';
export { findHermesc } from './hermes/find-hermesc';

/**
 * HMR module exports for oxc-bundler
 */

export { OxcDevEngine } from './dev-engine';
export type { DevEngineOptions, DevEngineEventMap } from './dev-engine';
export type {
  HMRServerMessage,
  HMRClientMessage,
  HMRClient,
  HMRServerError,
  HMRUpdateResult,
  BindingClientHmrUpdate,
} from './types';
export { applyHermesCompat, transformForHermes } from './hermes-compat-utils';

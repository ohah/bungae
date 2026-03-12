/**
 * HMR type definitions for oxc-bundler
 *
 * Custom HMR protocol (Rollipop-style) for ESM scope-hoisted output.
 * Metro's __d()/__r() protocol is incompatible with Rolldown's ESM output.
 */

/** Server → Client messages */
export type HMRServerMessage =
  | { type: 'hmr:update-start' }
  | { type: 'hmr:update'; code: string }
  | { type: 'hmr:update-done' }
  | { type: 'hmr:reload' }
  | { type: 'hmr:error'; payload: HMRServerError };

/** Client → Server messages */
export type HMRClientMessage =
  | { type: 'hmr:connected'; bundleEntry: string; platform: string }
  | { type: 'hmr:module-registered'; modules: string[] }
  | { type: 'hmr:invalidate'; moduleId: string };

export interface HMRServerError {
  type: string;
  message: string;
  errors: Array<{
    description: string;
    filename?: string;
    lineNumber?: number;
    column?: number;
  }>;
}

/** HMR client info tracked by the server */
export interface HMRClient {
  id: string;
  platform: string;
  bundleEntry: string;
  send: (msg: string) => void;
}

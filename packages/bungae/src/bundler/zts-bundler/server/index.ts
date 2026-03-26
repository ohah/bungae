/**
 * ZTS Dev Server
 *
 * HTTP + WebSocket server for development with ZTS bundler.
 * Handles bundle serving, HMR, and DevTools integration.
 *
 * TODO: Implement once ZTS NAPI addon supports incremental builds.
 */

import type { ResolvedConfig } from '../../../config/types';

/**
 * Start dev server with ZTS bundler
 */
export async function serveWithZts(
  _config: ResolvedConfig,
): Promise<{ stop: () => Promise<void> }> {
  throw new Error(
    'ZTS dev server is not yet implemented.\n' +
      'Use bundler: \'oxc\' or \'graph\' for development.\n' +
      'ZTS bundler currently supports production builds only.',
  );
}

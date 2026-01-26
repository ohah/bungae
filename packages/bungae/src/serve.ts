/**
 * Serve command - Start development server
 */

import { serveWithGraph } from './bundler';
import type { ResolvedConfig } from './config/types';

export async function serve(config: ResolvedConfig): Promise<void> {
  // Use Graph bundler for dev server
  await serveWithGraph(config);
}

/**
 * Serve command - Start development server
 */

import { serve as serveBundler } from './bundler';
import type { ResolvedConfig } from './config/types';

export async function serve(config: ResolvedConfig): Promise<void> {
  // Use bundler based on config.bundler option
  await serveBundler(config);
}

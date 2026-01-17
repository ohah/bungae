/**
 * Bungae - A lightning-fast React Native bundler powered by Bun
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.1';

export interface BungaeConfig {
  /** Project root directory */
  root?: string;
  /** Entry file path */
  entry?: string;
  /** Target platform */
  platform?: 'ios' | 'android';
  /** Development mode */
  dev?: boolean;
  /** Enable minification */
  minify?: boolean;
  /** Output directory */
  outDir?: string;
}

export function defineConfig(config: BungaeConfig): BungaeConfig {
  return config;
}

export async function build(config: BungaeConfig): Promise<void> {
  console.log('Bungae build started...', config);
  // TODO: Implement build logic
}

export async function serve(config: BungaeConfig): Promise<void> {
  console.log('Bungae dev server started...', config);
  // TODO: Implement dev server logic
}

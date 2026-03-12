/**
 * Platform Resolver Plugin for Rolldown
 *
 * Resolves platform-specific file extensions for React Native.
 * e.g., `./Button` → `./Button.ios.tsx` on iOS platform
 *
 * Resolution order (for platform 'ios'):
 * 1. .ios.tsx, .ios.ts, .ios.jsx, .ios.js
 * 2. .native.tsx, .native.ts, .native.jsx, .native.js
 * 3. .tsx, .ts, .jsx, .js
 */

import { existsSync } from 'fs';
import { dirname, join, extname } from 'path';

import type { Plugin } from 'rolldown';

import type { ResolvedConfig } from '../../../config/types';

export function platformResolverPlugin(config: ResolvedConfig): Plugin {
  const { platform } = config;
  const sourceExts = config.resolver.sourceExts.map((ext) =>
    ext.startsWith('.') ? ext : `.${ext}`,
  );

  // Build extension resolution order with platform priority
  const platformExts = sourceExts.flatMap((ext) => [`.${platform}${ext}`, `.native${ext}`, ext]);

  return {
    name: 'bungae:platform-resolver',

    resolveId: {
      filter: { id: /^\./ },
      async handler(source, importer, _options) {
        if (!importer) return null;

        const importerDir = dirname(importer);
        const ext = extname(source);

        // If source already has an extension, try platform variants first
        if (ext && sourceExts.includes(ext)) {
          const basePath = join(importerDir, source.slice(0, -ext.length));
          for (const platformExt of [`.${platform}${ext}`, `.native${ext}`]) {
            const candidate = basePath + platformExt;
            if (existsSync(candidate)) {
              return { id: candidate };
            }
          }
          return null; // Let Rolldown handle default resolution
        }

        // No extension: try all platform extension combinations
        if (!ext || !sourceExts.includes(ext)) {
          const basePath = join(importerDir, source);

          // Check if it's a directory with index file
          for (const platformExt of platformExts) {
            const candidate = basePath + platformExt;
            if (existsSync(candidate)) {
              return { id: candidate };
            }
          }

          // Try as directory with index
          for (const platformExt of platformExts) {
            const candidate = join(basePath, `index${platformExt}`);
            if (existsSync(candidate)) {
              return { id: candidate };
            }
          }
        }

        return null;
      },
    },
  };
}

/**
 * Build the full list of extensions for Rolldown resolve config
 */
export function buildExtensions(platform: string, sourceExts: string[]): string[] {
  const normalized = sourceExts.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));

  const extensions: string[] = [];
  for (const ext of normalized) {
    extensions.push(`.${platform}${ext}`);
    extensions.push(`.native${ext}`);
    extensions.push(ext);
  }
  return extensions;
}

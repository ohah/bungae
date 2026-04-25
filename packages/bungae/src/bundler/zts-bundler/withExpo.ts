/**
 * withExpo — Apply Expo-specific options to a Bungae config.
 *
 * Mirrors the runtime opt-in pattern of `@expo/metro-config`:
 *   import { defineConfig, withExpo } from 'bungae';
 *   export default withExpo(defineConfig({...}));
 *
 * Adds:
 *   - serializer.runBeforeMainModule: `expo/winter` + `@expo/metro-runtime`
 *   - resolver.assetExts:             heic, avif, db (expo-image, expo-sqlite)
 *   - resolver.blockList:             `.expo/types/**` (generated d.ts)
 *   - server.silentConsoleErrorPatterns: winter polyfill warning
 *
 * Resolves all paths from `config.root`, so monorepo hoisting in unrelated
 * workspace packages cannot leak Expo into a vanilla RN config.
 */

import { dirname, join } from 'path';
import { readFileSync } from 'fs';

import type { BungaeConfig } from '../../config/types';
import { tryResolve } from './rn-constants';

/**
 * Detect whether a project's own `package.json` declares Expo as a direct
 * dependency. Used by zero-config mode to decide whether to auto-apply
 * `withExpo()`. Hoisted-monorepo dependencies in workspace root do NOT
 * trigger detection — only the project's own deps do.
 */
export function detectExpo(
  projectRoot: string,
): { name: 'expo' | 'expo-router'; version: string } | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.expo) return { name: 'expo', version: deps.expo };
    if (deps['expo-router'])
      return { name: 'expo-router', version: deps['expo-router'] };
  } catch {
    // Missing or malformed package.json — treat as non-Expo project.
  }
  return undefined;
}

const EXPO_ASSET_EXTS = ['.heic', '.avif', '.db'] as const;

/** Normalize "ext" / ".ext" → ".ext" for dedup comparisons. */
function normalizeExt(ext: string): string {
  return ext.startsWith('.') ? ext : `.${ext}`;
}
const EXPO_BLOCK_LIST: RegExp[] = [/\.expo[\\/]types/];
const WINTER_POLYFILL_WARNING_PATTERN =
  '^Failed to set polyfill\\.\\s+\\w+\\s+is not configurable\\.?$';

function resolveExpoModules(root: string): {
  winter: string | undefined;
  metroRuntime: string | undefined;
} {
  const winter =
    tryResolve('expo/src/winter/index.ts', root) ??
    tryResolve('expo/src/winter/index', root) ??
    tryResolve('expo/build/winter/index.js', root);

  // expo-router가 끌어오는 동일 인스턴스 보장 — top-level 패키지가 hoisted된
  // 경우 instance가 갈라져 require chain이 깨질 수 있어 expo-router의 dirname
  // 기준으로 resolve.
  const expoRouterPkg = tryResolve('expo-router/package.json', root);
  const metroRuntimeBase = expoRouterPkg ? dirname(expoRouterPkg) : root;
  const metroRuntime = tryResolve('@expo/metro-runtime', metroRuntimeBase);

  return { winter, metroRuntime };
}

export function withExpo<T extends BungaeConfig>(config: T): T {
  const root = config.root ?? process.cwd();
  const { winter, metroRuntime } = resolveExpoModules(root);

  const expoModules: string[] = [];
  if (winter) expoModules.push(winter);
  if (metroRuntime) expoModules.push(metroRuntime);

  return {
    ...config,
    resolver: {
      ...config.resolver,
      assetExts: (() => {
        const existing = config.resolver?.assetExts ?? [];
        const existingNormalized = new Set(existing.map(normalizeExt));
        return [
          ...existing,
          ...EXPO_ASSET_EXTS.filter((ext) => !existingNormalized.has(ext)),
        ];
      })(),
      blockList: [...(config.resolver?.blockList ?? []), ...EXPO_BLOCK_LIST],
    },
    serializer: {
      ...config.serializer,
      runBeforeMainModule: [
        ...(config.serializer?.runBeforeMainModule ?? []),
        ...expoModules,
      ],
    },
    server: {
      ...config.server,
      silentConsoleErrorPatterns: [
        ...(config.server?.silentConsoleErrorPatterns ?? []),
        WINTER_POLYFILL_WARNING_PATTERN,
      ],
    },
  };
}

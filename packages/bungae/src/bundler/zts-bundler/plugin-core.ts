/**
 * ZTS Plugin Core — Pure logic extracted from asset-plugin.ts and babel-plugin.ts
 *
 * IPC-independent functions for asset processing and Babel transformation.
 * Used by napi-plugins.ts (NAPI in-process) and the existing IPC plugins.
 */

import { createHash } from 'node:crypto';
import { openSync, readSync, readFileSync, readdirSync, closeSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';

// ===== Constants =====

/** Default asset file extensions (Metro-compatible) */
export const ASSET_EXTS_DEFAULT: string[] = [
  '.bmp',
  '.gif',
  '.jpg',
  '.jpeg',
  '.png',
  '.psd',
  '.svg',
  '.webp',
  '.tiff',
  '.tif',
  '.xml',
  '.avif',
  '.ico',
  '.m4v',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.webm',
  '.aac',
  '.aiff',
  '.caf',
  '.m4a',
  '.mp3',
  '.wav',
  '.html',
  '.pdf',
  '.yaml',
  '.yml',
  '.otf',
  '.ttf',
  '.woff',
  '.woff2',
];

/** Inline AssetRegistry module code — replaces @react-native/assets-registry */
export const ASSET_REGISTRY_CODE = `
var assets = [];
function registerAsset(asset) {
  return assets.push(asset);
}
function getAssetByID(assetId) {
  return assets[assetId - 1];
}
module.exports = { registerAsset: registerAsset, getAssetByID: getAssetByID };
`;

/** ZTS HMR client code (loaded from dist/runtime or fallback dummy) */
export const ZTS_HMR_CLIENT_CODE = (() => {
  try {
    return readFileSync(join(__dirname, 'runtime/zts-hmr-client.js'), 'utf-8');
  } catch {
    return 'module.exports = { setup() {}, enable() {}, disable() {}, registerBundle() {}, log() {} }; module.exports.default = module.exports;';
  }
})();

/** Import specifiers that RN uses to import AssetRegistry — both redirect to virtual module */
export const ASSET_REGISTRY_SPECIFIERS = [
  'react-native/Libraries/Image/AssetRegistry',
  '@react-native/assets-registry/registry',
];

/** HMRClient.js path suffix for onLoad interception */
export const HMR_CLIENT_SUFFIX = '/Libraries/Utilities/HMRClient.js';

// iOS: 1x, 2x, 3x only (Hermes compatibility)
export const IOS_SCALES = new Set([1, 2, 3]);

export const SCALE_REGEX = /@(\d+(?:\.\d+)?)x/;

// ===== Image Dimensions =====

/**
 * Extract image dimensions from a buffer by reading format-specific headers.
 * Supports PNG, JPEG, GIF, WebP, BMP.
 */
export function getImageSizeFromBuffer(
  buffer: Buffer,
  ext: string,
): { width: number; height: number } {
  if (ext === '.png') {
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
  } else if (ext === '.jpg' || ext === '.jpeg') {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1]!;
      if (marker === 0xc0 || marker === 0xc2) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  } else if (ext === '.gif') {
    if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
  } else if (ext === '.webp') {
    if (
      buffer.length >= 30 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8 ' && buffer.length >= 30) {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      } else if (chunk === 'VP8L' && buffer.length >= 25) {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      } else if (chunk === 'VP8X' && buffer.length >= 30) {
        return {
          width: ((buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16)) & 0xffffff) + 1,
          height: ((buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16)) & 0xffffff) + 1,
        };
      }
    }
  } else if (ext === '.bmp') {
    if (buffer.length >= 26 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
    }
  }
  return { width: 0, height: 0 };
}

/**
 * Read image dimensions from a file on disk.
 * For PNG/GIF, only reads the first 24 bytes (header-only).
 */
export function readImageDimensions(
  filePath: string,
  ext: string,
): { width: number; height: number } {
  try {
    if (ext === '.png' || ext === '.gif') {
      const buf = Buffer.alloc(24);
      const fd = openSync(filePath, 'r');
      try {
        readSync(fd, buf, 0, 24, 0);
      } finally {
        closeSync(fd);
      }
      return getImageSizeFromBuffer(buf, ext);
    }
    return getImageSizeFromBuffer(readFileSync(filePath), ext);
  } catch {
    return { width: 0, height: 0 };
  }
}

// ===== Scale Variants =====

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find available scale variants for an asset file (e.g., @2x, @3x).
 * Scans the directory for files matching the pattern `name@Nx.ext`.
 *
 * @param filePath  Absolute path to the asset file
 * @param platform  Target platform ('ios' | 'android') — iOS filters to 1x/2x/3x only
 */
export function findScales(filePath: string, platform: string): number[] {
  const ext = extname(filePath);
  const dir = dirname(filePath);
  const nameWithoutExt = basename(filePath, ext);

  try {
    const files = readdirSync(dir);
    const scales = new Set<number>([1]);
    const pattern = new RegExp(`^${escapeRegex(nameWithoutExt)}${SCALE_REGEX.source}$`);

    for (const file of files) {
      if (!file.endsWith(ext)) continue;
      const match = basename(file, ext).match(pattern);
      if (match?.[1]) {
        scales.add(parseFloat(match[1]));
      }
    }

    let result = Array.from(scales).sort((a, b) => a - b);
    if (platform === 'ios') {
      result = result.filter((s) => IOS_SCALES.has(s));
      if (result.length === 0) result = [1];
    }
    return result;
  } catch {
    return [1];
  }
}

// ===== Metro-compatible Asset Code Generation =====

/**
 * Compute Metro-compatible httpServerLocation for an asset.
 * Normalizes leading ../ for assets outside project root (e.g., node_modules).
 */
export function computeHttpServerLocation(filePath: string, projectRoot: string): string {
  const assetDir = dirname(filePath);
  let relativePath = relative(projectRoot, assetDir).replace(/\\/g, '/');
  while (relativePath.startsWith('../')) relativePath = relativePath.slice(3);
  if (relativePath === '..') relativePath = '';
  return relativePath && relativePath !== '.' ? `/assets/${relativePath}` : '/assets';
}

/**
 * Generate Metro-compatible asset registration code for a given asset file.
 *
 * Output: `require("react-native/.../AssetRegistry").registerAsset({...})`
 *
 * @param filePath     Absolute path to the asset file
 * @param config.projectRoot  Project root for httpServerLocation computation
 * @param config.platform     Target platform ('ios' | 'android')
 */
export function generateAssetCode(
  filePath: string,
  config: { projectRoot: string; platform: string },
): string {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath, extname(filePath));
  const type = extname(filePath).slice(1);
  const httpServerLocation = computeHttpServerLocation(filePath, config.projectRoot);
  const scales = findScales(filePath, config.platform);

  const buf = readFileSync(filePath);
  const { width, height } = getImageSizeFromBuffer(buf, ext);
  const hash = createHash('md5').update(buf).digest('hex').slice(0, 16);

  const assetData = JSON.stringify({
    __packager_asset: true,
    httpServerLocation,
    width,
    height,
    scales,
    hash,
    name,
    type,
  });

  return [
    `var _registry = require("${ASSET_REGISTRY_SPECIFIERS[0]}");`,
    `module.exports = _registry.registerAsset(${assetData});`,
  ].join('\n');
}

// ===== Babel Plugin Detection & Transformer =====

/**
 * Babel plugin patterns that ZTS handles natively — excluded from Babel pass-through.
 * Everything NOT in this list is forwarded to Babel automatically.
 */
const ZTS_NATIVE_PLUGIN_PATTERNS = [
  // ZTS ES5 매트릭스가 처리하는 변환
  'optional-chaining',
  'nullish-coalescing',
  'class-properties',
  'private-methods',
  'private-property-in-object',
  'flow-strip-types',
  'transform-flow',
  'transform-typescript',
  'transform-react-jsx',
  'transform-arrow-functions',
  'transform-block-scoping',
  'transform-shorthand-properties',
  'transform-template-literals',
  'transform-modules-commonjs',
  // ZTS 네이티브 워크릿 변환 (#1082)
  'react-native-worklets',
  'react-native-reanimated/plugin',
  'react-native-reanimated',
  // RN 기본 프리셋 (ZTS가 전체 처리)
  '@react-native/babel-preset',
];

/**
 * Detect whether the project has custom Babel plugins that require runtime transformation.
 * Checks babel.config.js for plugins matching known patterns (reanimated, nativewind, worklet).
 *
 * @param projectRoot  Project root directory containing babel.config.js
 */
/**
 * Check if a plugin name is handled natively by ZTS (should NOT be forwarded to Babel).
 */
function isZtsNativePlugin(name: string): boolean {
  return ZTS_NATIVE_PLUGIN_PATTERNS.some((pattern) => name.includes(pattern));
}

export function detectCustomPlugins(projectRoot: string): boolean {
  try {
    const configPath = join(projectRoot, 'babel.config.js');
    if (!existsSync(configPath)) return false;
    const config = require(configPath);
    const plugins: unknown[] = config?.plugins || [];
    // Any plugin NOT handled natively by ZTS → needs Babel
    return plugins.some((p) => {
      const name = typeof p === 'string' ? p : Array.isArray(p) ? p[0] : '';
      return typeof name === 'string' && !isZtsNativePlugin(name);
    });
  } catch {
    return false;
  }
}

/**
 * Create a lazy-loaded Babel transformer for custom plugins.
 * Babel and its config are loaded on first invocation to avoid startup latency.
 *
 * @param projectRoot  Project root directory containing babel.config.js
 * @returns  A transformer function: (code, filename) => transformed code or null
 */
export function createBabelTransformer(
  projectRoot: string,
): (code: string, filename: string) => string | null {
  let babel: any = null;
  let babelOptions: any = null;

  function ensureBabel() {
    if (babel) return;
    babel = require('@babel/core');

    const configPath = join(projectRoot, 'babel.config.js');
    const config = require(configPath);
    const plugins: unknown[] = config?.plugins || [];

    const customPlugins: unknown[] = [];
    for (const plugin of plugins) {
      const name = typeof plugin === 'string' ? plugin : Array.isArray(plugin) ? plugin[0] : '';
      if (typeof name === 'string' && !isZtsNativePlugin(name)) {
        // Preserve plugin options: ['plugin-name', { opt: val }] or just 'plugin-name'
        if (Array.isArray(plugin)) {
          try {
            customPlugins.push([
              require.resolve(plugin[0] as string),
              ...(plugin.slice(1) as unknown[]),
            ]);
          } catch {
            customPlugins.push(plugin);
          }
        } else {
          try {
            customPlugins.push(require.resolve(name));
          } catch {
            customPlugins.push(name);
          }
        }
      }
    }

    babelOptions = {
      presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
      plugins: customPlugins,
      babelrc: false,
      configFile: false,
      compact: false,
      sourceMaps: false,
    };

    const pluginNames = customPlugins.map((p) =>
      Array.isArray(p) ? (p[0] as string).split('/').pop() : String(p).split('/').pop(),
    );
    process.stderr.write(`[bungae:babel] loaded: ${pluginNames.join(', ')}\n`);
  }

  return (code: string, filename: string): string | null => {
    try {
      ensureBabel();
      const result = babel.transformSync(code, {
        ...babelOptions,
        filename,
      });
      if (result?.code && result.code !== code) {
        process.stderr.write(
          `[bungae:babel] ${filename.split('/').pop()}: ${code.length} -> ${result.code.length}\n`,
        );
        return result.code;
      }
      return null;
    } catch (err: any) {
      process.stderr.write(`[bungae:babel] error: ${err.message?.slice(0, 100)}\n`);
      throw err;
    }
  };
}

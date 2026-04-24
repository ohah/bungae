/**
 * Utility functions for Graph Bundler
 */

import { readFileSync } from 'fs';
import { dirname, relative, basename, extname } from 'path';

/**
 * ANSI color codes for terminal output (Metro-compatible)
 */
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  inverse: '\x1b[7m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

/**
 * Metro-compatible log badges.
 * Labels upper-cased and length-aligned to match `metro/src/lib/reporting.js`
 * (` INFO ` / ` WARN ` / ` ERROR `, cyan/yellow/red on inverse bold).
 */
export function logInfo(...args: unknown[]): void {
  console.log(`${colors.inverse}${colors.bold}${colors.cyan} INFO ${colors.reset}`, ...args);
}

export function logWarn(...args: unknown[]): void {
  console.warn(`${colors.inverse}${colors.bold}${colors.yellow} WARN ${colors.reset}`, ...args);
}

export function logError(...args: unknown[]): void {
  console.error(`${colors.inverse}${colors.bold}${colors.red} ERROR ${colors.reset}`, ...args);
}

/**
 * Metro-style BUNDLE status line — emitted at build completion and per request.
 * Matches `TerminalReporter._getBundleStatusMessage` color scheme:
 * - `done`    → green inverse bold
 * - `failed`  → red
 * - `request` → yellow (in-flight color, reused for "cached bundle served")
 *
 * @param subject  Right-hand content — entry path (done/failed) or URL (request).
 * @param detail   Optional dim trailing metadata (e.g. `(350 files, 123 KB, 1234ms)`).
 */
export function logBundle(
  phase: 'done' | 'failed' | 'request',
  platform: string,
  subject: string,
  detail?: string,
): void {
  const color = phase === 'done' ? colors.green : phase === 'failed' ? colors.red : colors.yellow;
  const badge = `${color}${colors.inverse}${colors.bold} BUNDLE ${colors.reset}`;
  const tail = detail ? ` ${colors.dim}${detail}${colors.reset}` : '';
  console.log(`${badge} ${colors.dim}[${platform}]${colors.reset} ${subject}${tail}`);
}

/**
 * Helper to create a banner line with exact width (59 chars inside box)
 */
function bannerLine(content: string): string {
  // eslint-disable-next-line no-control-regex
  const contentLength = content.replace(/\x1b\[[0-9;]*m/g, '').length;
  const padding = 59 - contentLength;
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;
  return `${colors.cyan}    ║${colors.reset}${' '.repeat(leftPad)}${content}${' '.repeat(rightPad)}${colors.cyan}║${colors.reset}`;
}

/**
 * Print Bungae ASCII art banner with version
 */
export function printBanner(version: string): void {
  const versionText = `v${version}`;

  // "BUNGAE" ASCII art (6 lines) with gradient colors
  const bungaeLines = [
    '██████╗ ██╗   ██╗███╗   ██╗ ██████╗  █████╗ ███████╗',
    '██╔══██╗██║   ██║████╗  ██║██╔════╝ ██╔══██╗██╔════╝',
    '██████╔╝██║   ██║██╔██╗ ██║██║  ███╗███████║█████╗  ',
    '██╔══██╗██║   ██║██║╚██╗██║██║   ██║██╔══██║██╔══╝  ',
    '██████╔╝╚██████╔╝██║ ╚████║╚██████╔╝██║  ██║███████╗',
    '╚═════╝  ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝',
  ];

  const gradientColors = [
    colors.yellow,
    colors.yellow,
    colors.blue,
    colors.blue,
    colors.magenta,
    colors.magenta,
  ];

  const banner = `
${colors.cyan}    ╔${'═'.repeat(59)}╗${colors.reset}
${bannerLine('')}
${bungaeLines.map((line, i) => bannerLine(`${colors.bold}${gradientColors[i]}${line}${colors.reset}`)).join('\n')}
${bannerLine('')}
${bannerLine(`${colors.cyan}Lightning Fast React Native Bundler${colors.reset}`)}
${bannerLine(`${colors.gray}${versionText}${colors.reset}`)}
${bannerLine('')}
${colors.cyan}    ╚${'═'.repeat(59)}╝${colors.reset}
`;
  console.log(banner);
}

/**
 * Get image dimensions from a PNG file (basic implementation)
 */
export function getImageSize(filePath: string): { width: number; height: number } {
  try {
    const buffer = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();

    if (ext === '.png') {
      // PNG: width at offset 16, height at offset 20 (big endian)
      if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      // JPEG: Find SOF0 marker (0xFF 0xC0) and read dimensions
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          // SOF0 or SOF2
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    } else if (ext === '.gif') {
      // GIF: width at offset 6, height at offset 8 (little endian)
      if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
        const width = buffer.readUInt16LE(6);
        const height = buffer.readUInt16LE(8);
        return { width, height };
      }
    }
  } catch {
    // Ignore errors
  }

  // Default size if we can't read the image
  return { width: 0, height: 0 };
}

/**
 * Generate asset module code that registers the asset with AssetRegistry
 */
export function generateAssetModuleCode(assetPath: string, projectRoot: string): string {
  const { width, height } = getImageSize(assetPath);
  const name = basename(assetPath, extname(assetPath));
  const type = extname(assetPath).slice(1); // Remove the dot
  const relativePath = relative(projectRoot, dirname(assetPath));

  // Metro behavior: httpServerLocation always uses forward slashes (/) even on Windows
  // Convert Windows backslashes to forward slashes for URL compatibility
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');

  // Metro behavior: if relativePath is empty or '.', use empty string for httpServerLocation
  // This means assets in project root are served from /assets/
  const httpServerLocation =
    normalizedRelativePath && normalizedRelativePath !== '.'
      ? `/assets/${normalizedRelativePath}`
      : '/assets';

  // Generate Metro-compatible asset registration
  return `module.exports = require("react-native/Libraries/Image/AssetRegistry").registerAsset({
  "__packager_asset": true,
  "httpServerLocation": "${httpServerLocation}",
  "width": ${width},
  "height": ${height},
  "scales": [1],
  "hash": "${Date.now().toString(16)}",
  "name": "${name}",
  "type": "${type}"
});`;
}

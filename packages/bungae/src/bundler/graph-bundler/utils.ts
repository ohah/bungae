/**
 * Utility functions for Graph Bundler
 */

import { readFileSync } from 'fs';
import { dirname, relative, basename, extname } from 'path';

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  yellow: '\x1b[33m',
  brightYellow: '\x1b[93m',
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  white: '\x1b[37m',
  brightWhite: '\x1b[97m',
  gray: '\x1b[90m',
  brightGray: '\x1b[37m', // Light gray for light terminals
  magenta: '\x1b[35m',
  brightMagenta: '\x1b[95m',
  blue: '\x1b[34m',
  brightBlue: '\x1b[94m',
};

/**
 * Helper to create a banner line with exact width (59 chars inside box)
 */
function bannerLine(content: string): string {
  // eslint-disable-next-line no-control-regex
  const contentLength = content.replace(/\x1b\[[0-9;]*m/g, '').length;
  const padding = 59 - contentLength;
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;
  return `${colors.brightCyan}    ║${colors.reset}${' '.repeat(leftPad)}${content}${' '.repeat(rightPad)}${colors.brightCyan}║${colors.reset}`;
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

  // Color gradient for each line
  const gradientColors = [
    colors.brightYellow,
    colors.brightYellow,
    colors.brightBlue, // Blue for transition
    colors.brightBlue,
    colors.brightMagenta,
    colors.brightMagenta,
  ];

  const banner = `
${colors.brightCyan}    ╔═══════════════════════════════════════════════════════════╗${colors.reset}
${bannerLine('')}
${bungaeLines.map((line, i) => bannerLine(`${colors.bright}${gradientColors[i]}${line}${colors.reset}`)).join('\n')}
${bannerLine('')}
${bannerLine(`${colors.cyan}Lightning Fast React Native Bundler${colors.reset}`)}
${bannerLine(`${colors.gray}${versionText}${colors.reset}`)}
${bannerLine('')}
${colors.brightCyan}    ╚═══════════════════════════════════════════════════════════╝${colors.reset}
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

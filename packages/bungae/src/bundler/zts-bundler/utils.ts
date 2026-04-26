/**
 * Logging utilities for the ZTS bundler and dev server.
 */

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

/**
 * Terminal reporter for bundle progress (Metro-compatible)
 * Displays progress bar and percentage in terminal
 */

import { relative, basename, dirname } from 'path';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  bgGreen: '\x1b[42m',
  yellow: '\x1b[33m',
  bgYellow: '\x1b[43m',
  red: '\x1b[31m',
  bgRed: '\x1b[41m',
  white: '\x1b[37m',
  bgWhite: '\x1b[47m',
};

// Progress bar characters (Metro-compatible)
const DARK_BLOCK_CHAR = '\u2593'; // ▓
const LIGHT_BLOCK_CHAR = '\u2591'; // ░
const MAX_PROGRESS_BAR_CHAR_WIDTH = 16;

type BundleProgress = {
  entryFile: string;
  bundleType: string;
  transformedFileCount: number;
  totalFileCount: number;
  ratio: number;
};

/**
 * Terminal reporter for bundle progress
 * Metro-compatible terminal UI
 */
export class TerminalReporter {
  private _activeBundles: Map<string, BundleProgress> = new Map();
  private _lastUpdateTime: Map<string, number> = new Map();
  private readonly _throttleMs: number = 100; // Update at most every 100ms
  private _lastRenderedLength: number = 0; // Track last rendered message length

  /**
   * Update bundle progress
   * Throttled to prevent too frequent updates
   */
  updateBundleProgress(
    buildID: string,
    entryFile: string,
    bundleType: string,
    transformedFileCount: number,
    totalFileCount: number,
  ): void {
    const now = Date.now();
    const lastUpdate = this._lastUpdateTime.get(buildID) || 0;

    // Throttle updates (but always update if totalFileCount changed significantly)
    const shouldUpdate =
      now - lastUpdate >= this._throttleMs ||
      totalFileCount <= 10 || // Always update for small bundles
      transformedFileCount === totalFileCount; // Always update when complete

    if (!shouldUpdate) {
      return;
    }

    this._lastUpdateTime.set(buildID, now);

    // Calculate ratio (Metro-compatible: use conservative progress calculation)
    // Metro uses Math.pow(ratio, 2) to prevent ratio from going backwards
    // But when complete (transformedFileCount === totalFileCount), show 100%
    let ratio: number;
    if (transformedFileCount === totalFileCount && totalFileCount > 0) {
      // Complete: show 100%
      ratio = 1.0;
    } else {
      // In progress: use conservative calculation, cap at 99.9%
      const baseRatio = transformedFileCount / Math.max(totalFileCount, 10);
      ratio = Math.min(Math.pow(baseRatio, 2), 0.999);
    }

    const currentProgress = this._activeBundles.get(buildID);
    if (currentProgress) {
      // Update existing progress (prevent ratio from going backwards, but allow 100% when complete)
      const newRatio =
        transformedFileCount === totalFileCount && totalFileCount > 0
          ? 1.0 // Always show 100% when complete
          : Math.max(ratio, currentProgress.ratio);
      this._activeBundles.set(buildID, {
        ...currentProgress,
        transformedFileCount,
        totalFileCount,
        ratio: newRatio,
      });
    } else {
      // New bundle
      this._activeBundles.set(buildID, {
        entryFile,
        bundleType,
        transformedFileCount,
        totalFileCount,
        ratio,
      });
    }

    this._render();
  }

  /**
   * Mark bundle as done
   */
  bundleDone(buildID: string): void {
    const progress = this._activeBundles.get(buildID);
    if (progress) {
      // Clear the progress line and show completion
      const clearWidth = Math.max(this._lastRenderedLength, 120);
      process.stdout.write('\r' + ' '.repeat(clearWidth) + '\r'); // Clear line

      // Show 100% completion
      const msg = this._getBundleStatusMessage(
        {
          ...progress,
          ratio: 1,
          transformedFileCount: progress.totalFileCount,
        },
        'done',
      );
      console.log(msg); // Use console.log to move to next line
      this._lastRenderedLength = 0; // Reset
      this._activeBundles.delete(buildID);
      this._lastUpdateTime.delete(buildID);
    }
  }

  /**
   * Log source map request (Metro-compatible)
   * Example: MAP ./index.js
   */
  logMapRequest(entryFile: string): void {
    // Normalize entry file path for display
    let localPath: string;
    try {
      localPath = relative('.', entryFile);
      // If relative path is too long or goes up too many levels, use basename
      if (localPath.startsWith('../') || localPath.length > 50) {
        localPath = basename(entryFile);
      }
    } catch {
      localPath = entryFile;
    }

    // Format: MAP ./index.js (Metro-compatible)
    const badge = colors.green + colors.bold + ' MAP ' + colors.reset;
    const filePath = colors.bold + `./${localPath}` + colors.reset;
    console.log(badge + filePath);
  }

  /**
   * Mark bundle as failed
   */
  bundleFailed(buildID: string): void {
    const progress = this._activeBundles.get(buildID);
    if (progress) {
      // Clear the progress line and show failure
      const clearWidth = Math.max(this._lastRenderedLength, 120);
      process.stdout.write('\r' + ' '.repeat(clearWidth) + '\r'); // Clear line

      const msg = this._getBundleStatusMessage(progress, 'failed');
      console.log(msg); // Use console.log to move to next line
      this._lastRenderedLength = 0; // Reset
      this._activeBundles.delete(buildID);
      this._lastUpdateTime.delete(buildID);
    }
  }

  /**
   * Get bundle status message (Metro-compatible format)
   * Example: BUNDLE index.js ▓▓▓▓▓░░░░░░░░░░░ 36.6% (4790/7922)
   */
  private _getBundleStatusMessage(
    progress: BundleProgress,
    phase: 'in_progress' | 'done' | 'failed',
  ): string {
    const { entryFile, bundleType, transformedFileCount, totalFileCount, ratio } = progress;

    // Normalize entry file path for display
    let localPath: string;
    try {
      localPath = relative('.', entryFile);
      // If relative path is too long or goes up too many levels, use basename
      if (localPath.startsWith('../') || localPath.length > 50) {
        localPath = basename(entryFile);
      }
    } catch {
      // If relative() fails, just use the entryFile as-is
      localPath = entryFile;
    }

    const filledBar = Math.floor(ratio * MAX_PROGRESS_BAR_CHAR_WIDTH);
    const emptyBar = MAX_PROGRESS_BAR_CHAR_WIDTH - filledBar;

    // Bundle type color
    const bundleTypeColor =
      phase === 'done' ? colors.green : phase === 'failed' ? colors.red : colors.yellow;

    // Progress bar
    const progressBar =
      phase === 'in_progress'
        ? colors.green +
          colors.bgGreen +
          DARK_BLOCK_CHAR.repeat(filledBar) +
          colors.reset +
          colors.bgWhite +
          colors.white +
          LIGHT_BLOCK_CHAR.repeat(emptyBar) +
          colors.reset +
          colors.bold +
          ` ${(100 * ratio).toFixed(1)}% ` +
          colors.reset +
          colors.dim +
          `(${transformedFileCount}/${totalFileCount})` +
          colors.reset
        : '';

    // Bundle type badge (inverse colors)
    const bundleTypeBadge =
      bundleTypeColor + colors.bold + ` ${bundleType.toUpperCase()} ` + colors.reset;

    // File path
    const pathDir = dirname(localPath);
    const pathBase = basename(localPath);
    const filePath =
      pathDir !== '.' && pathDir !== '/'
        ? colors.dim + ` ${pathDir}/` + colors.reset + colors.bold + pathBase + colors.reset
        : colors.bold + pathBase + colors.reset;

    return bundleTypeBadge + filePath + ' ' + progressBar;
  }

  /**
   * Render current status to terminal
   * Uses carriage return to overwrite the same line (Metro-compatible)
   * Note: This assumes we're always at the end of the terminal output
   */
  private _render(): void {
    const bundles = Array.from(this._activeBundles.values());
    if (bundles.length === 0) {
      return;
    }

    // Render each active bundle
    const messages = bundles.map((progress) =>
      this._getBundleStatusMessage(progress, 'in_progress'),
    );

    // Metro-compatible: Use carriage return to overwrite the same line
    // Single bundle: just overwrite the current line (most common case)
    if (bundles.length === 1) {
      // Clear line and write (no newline at end)
      const message = messages[0] || '';
      // Calculate actual display width (without ANSI codes)
      // eslint-disable-next-line no-control-regex -- ANSI escape codes are required for terminal formatting
      const displayWidth = message.replace(/\x1b\[[0-9;]*m/g, '').length;
      this._lastRenderedLength = displayWidth;

      // Clear and write on same line (no newline) - use ANSI escape to clear to end of line
      process.stdout.write('\r' + '\x1b[K' + message);
    } else {
      // Multiple bundles: clear previous lines and write new status
      // Move cursor up by number of bundles, then clear and write
      process.stdout.write('\x1b[' + bundles.length + 'A'); // Move up
      for (let i = 0; i < bundles.length; i++) {
        const message = messages[i] || '';
        process.stdout.write('\r' + '\x1b[K' + message); // Clear to end of line and write
        if (i < bundles.length - 1) {
          process.stdout.write('\n'); // New line for next bundle
        }
      }
      this._lastRenderedLength = 0; // Reset for multi-bundle case
    }
  }
}

/**
 * Global terminal reporter instance
 */
let globalReporter: TerminalReporter | null = null;

/**
 * Get or create global terminal reporter
 */
export function getTerminalReporter(): TerminalReporter {
  if (!globalReporter) {
    globalReporter = new TerminalReporter();
  }
  return globalReporter;
}

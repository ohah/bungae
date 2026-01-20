/**
 * File Watcher - Watches for file changes and invalidates build cache
 *
 * This module provides file watching functionality for the dev server.
 * When files change, it invalidates the build cache to trigger a rebuild
 * on the next bundle request.
 */

import { watch } from 'fs';
import type { FSWatcher } from 'fs';

export interface FileWatcherOptions {
  root: string;
  onFileChange: () => void;
  debounceMs?: number;
}

export interface FileWatcher {
  close: () => void;
}

/**
 * Check if a file path should be ignored
 */
function shouldIgnore(filePath: string): boolean {
  if (!filePath) return true;
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized.includes('/node_modules/') ||
    normalized.includes('/.git/') ||
    normalized.includes('/dist/') ||
    normalized.includes('/build/') ||
    normalized.includes('/.next/') ||
    normalized.includes('/.turbo/') ||
    normalized.includes('/.bun/') ||
    normalized.startsWith('.') ||
    normalized.includes('/.DS_Store') ||
    normalized.endsWith('.log')
  );
}

/**
 * Create a file watcher that monitors the project root for changes
 * and calls the callback when files change (with debouncing)
 */
export function createFileWatcher(options: FileWatcherOptions): FileWatcher {
  const { root, onFileChange, debounceMs = 300 } = options;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename || shouldIgnore(filename)) {
        return;
      }

      // Only watch for change events (not rename which can be noisy)
      if (eventType === 'change') {
        // Debounce: wait after last change before calling callback
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          onFileChange();
          debounceTimer = null;
        }, debounceMs);
      }
    });

    console.log(`[bungae] Watching for file changes in ${root}`);
  } catch (error) {
    console.warn('[bungae] Failed to start file watcher:', error);
    console.warn('[bungae] File changes will not trigger automatic rebuilds');
  }

  return {
    close: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (watcher) {
        try {
          watcher.close();
        } catch {
          // Ignore errors when closing
        }
        watcher = null;
      }
    },
  };
}

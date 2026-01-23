/**
 * File Watcher - Watches for file changes and invalidates build cache
 *
 * This module provides file watching functionality for the dev server.
 * When files change, it invalidates the build cache to trigger a rebuild
 * on the next bundle request.
 */

import { existsSync, watch } from 'fs';
import type { FSWatcher } from 'fs';
import { resolve } from 'path';

export interface FileWatcherOptions {
  root: string;
  onFileChange: (changedFiles: string[]) => void;
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
  const changedFilesSet = new Set<string>();

  try {
    watcher = watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename || shouldIgnore(filename)) {
        return;
      }

      // Handle both 'change' and 'rename' events
      // Many editors (VSCode, etc.) use atomic writes which trigger 'rename' events:
      // 1. Write to temp file
      // 2. Delete original file
      // 3. Rename temp file to original name
      // We need to handle 'rename' to catch these atomic writes
      if (eventType === 'change' || eventType === 'rename') {
        const fullPath = resolve(root, filename);

        // Check if it's a JS/TS/JSON file we care about
        const ext = filename.split('.').pop()?.toLowerCase();
        const isSourceFile = ['js', 'jsx', 'ts', 'tsx', 'json'].includes(ext || '');
        if (!isSourceFile) {
          return;
        }

        // For rename events, only process if file exists (not deletion)
        // This prevents false triggers during server startup or file deletions
        if (!existsSync(fullPath)) {
          return;
        }

        changedFilesSet.add(fullPath);

        // Debounce: wait after last change before calling callback
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          const changedFiles = Array.from(changedFilesSet);
          changedFilesSet.clear();
          onFileChange(changedFiles);
          debounceTimer = null;
        }, debounceMs);
      }
    });

    // File watcher started (silent)
  } catch (error) {
    console.warn('Failed to start file watcher:', error);
    console.warn('File changes will not trigger automatic rebuilds');
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

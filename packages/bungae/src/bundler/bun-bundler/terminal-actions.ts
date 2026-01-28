/**
 * Terminal keyboard shortcuts handler for dev server
 * Metro-compatible terminal actions
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface TerminalActionsOptions {
  /** Enable global hotkey support */
  enabled: boolean;
  /** HMR clients to send messages to */
  hmrClients: Set<{ send: (msg: string) => void }>;
  /** Clear cache callback */
  onClearCache: () => void;
  /** Project root directory */
  projectRoot: string;
  /** Dev server port */
  port: number;
  /** Broadcast function for message socket (reload/devMenu) */
  broadcast?: (method: string, params?: Record<string, any>) => void;
}

/**
 * Setup terminal keyboard shortcuts
 * Metro-compatible shortcuts:
 * - `r`: Reload app
 * - `d`: Open Dev Menu
 * - `j`: Open DevTools
 * - `i`: Open iOS Simulator
 * - `a`: Open Android Emulator
 * - `c`: Clear cache
 */
export function setupTerminalActions(options: TerminalActionsOptions): () => void {
  const { enabled, onClearCache, port, broadcast } = options;

  if (!enabled) {
    return () => {
      // No-op cleanup
    };
  }

  // Check if stdin is a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    // Not in interactive mode, skip terminal actions
    return () => {
      // No-op cleanup
    };
  }

  // Set stdin to raw mode to capture individual key presses
  const wasRaw = process.stdin.isRaw;
  if (!wasRaw) {
    process.stdin.setRawMode(true);
  }

  // Resume stdin (it might be paused)
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  // Handle key presses
  const handleKeyPress = (key: string) => {
    // Handle Ctrl+C separately (it's \u0003)
    // In raw mode, Ctrl+C doesn't automatically send SIGINT, so we need to handle it
    if (key === '\u0003') {
      // Remove stdin listener before sending signal to prevent race conditions
      if (process.stdin.isRaw) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', handleKeyPress);
      }
      // Send SIGINT to the current process
      process.kill(process.pid, 'SIGINT');
      return;
    }

    // Handle Ctrl+D (EOF)
    if (key === '\u0004') {
      // Remove stdin listener before sending signal to prevent race conditions
      if (process.stdin.isRaw) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', handleKeyPress);
      }
      // Send SIGTERM or exit
      process.kill(process.pid, 'SIGTERM');
      return;
    }

    switch (key.toLowerCase()) {
      case 'r':
        // Reload app
        handleReload();
        break;

      case 'd':
        // Open Dev Menu
        handleDevMenu();
        break;

      case 'j':
        // Open DevTools
        handleOpenDevTools();
        break;

      case 'i':
        // Open iOS Simulator
        handleOpenIOSSimulator();
        break;

      case 'a':
        // Open Android Emulator
        handleOpenAndroidEmulator();
        break;

      case 'c':
        // Clear cache
        handleClearCache();
        break;

      default:
        // Ignore other keys
        break;
    }
  };

  const handleReload = () => {
    console.log('[Terminal] Reloading app...');
    // Metro's reload mechanism:
    // When 'r' is pressed in terminal, React Native CLI calls /reload HTTP endpoint
    // The server then broadcasts 'reload' via message socket WebSocket (/message)
    // React Native app listens to message socket and calls DevSettings.reload()
    if (broadcast) {
      // Use message socket broadcast (Metro-compatible)
      broadcast('reload');
      console.log('[Terminal] Broadcast reload sent');
    } else {
      // Fallback: try HTTP endpoint
      fetch(`http://localhost:${port}/reload`).catch((error) => {
        console.error('Error calling /reload endpoint:', error);
      });
    }
  };

  const handleDevMenu = () => {
    console.log('[Terminal] Opening Dev Menu...');
    // Metro's devMenu mechanism:
    // When 'd' is pressed in terminal, React Native CLI calls /devmenu HTTP endpoint
    // The server then broadcasts 'devMenu' via message socket WebSocket (/message)
    // React Native app listens to message socket and opens Dev Menu
    if (broadcast) {
      // Use message socket broadcast (Metro-compatible)
      broadcast('devMenu');
      console.log('[Terminal] Broadcast devMenu sent');
    } else {
      // Fallback: try HTTP endpoint
      fetch(`http://localhost:${port}/devmenu`).catch((error) => {
        console.error('Error calling /devmenu endpoint:', error);
      });
    }
  };

  const handleOpenDevTools = () => {
    console.log('[Terminal] Opening DevTools...');
    // Open React Native DevTools via /open-debugger endpoint
    // This endpoint is provided by @react-native/dev-middleware
    fetch(`http://localhost:${port}/open-debugger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }).catch((error) => {
      console.error('Error opening DevTools:', error);
    });
  };

  const handleOpenIOSSimulator = () => {
    if (process.platform !== 'darwin') {
      console.log('iOS Simulator is only available on macOS');
      return;
    }

    // Check if xcrun is available
    const xcrunPath = '/usr/bin/xcrun';
    if (!existsSync(xcrunPath)) {
      console.log('xcrun not found. iOS Simulator cannot be opened.');
      return;
    }

    // Open iOS Simulator using xcrun simctl
    // First, try to boot a simulator if none is running
    // Then open Simulator.app
    const openSimulator = spawn('open', ['-a', 'Simulator'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    openSimulator.unref();

    console.log('Opening iOS Simulator...');
  };

  const handleOpenAndroidEmulator = async () => {
    // Try to find Android SDK
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!androidHome) {
      console.log('ANDROID_HOME or ANDROID_SDK_ROOT not set. Android Emulator cannot be opened.');
      return;
    }

    const emulatorPath = join(androidHome, 'emulator', 'emulator');
    if (!existsSync(emulatorPath)) {
      console.log('Android emulator not found. Please check your Android SDK installation.');
      return;
    }

    // List available AVDs and open the first one
    // For simplicity, we'll try to open the default emulator
    // In a real implementation, you might want to list AVDs and let user choose
    const emulatorProcess = spawn(emulatorPath, ['-list-avds'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Read stdout from child_process.spawn
    let avdList = '';
    emulatorProcess.stdout.on('data', (data) => {
      avdList += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      emulatorProcess.on('close', (code) => {
        resolve(code ?? 0);
      });
    });

    if (exitCode !== 0) {
      console.log('Failed to list Android AVDs');
      return;
    }

    const avds = avdList
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (avds.length === 0) {
      console.log('No Android AVDs found. Please create an AVD first.');
      return;
    }

    // Use the first AVD (or you could use a default like "Pixel_5_API_33")
    const avdName = avds[0];
    if (!avdName) {
      console.log('No Android AVDs found. Please create an AVD first.');
      return;
    }

    // Validate AVD name to prevent command injection
    // AVD names should only contain alphanumeric characters, underscores, hyphens, and dots
    if (!/^[a-zA-Z0-9._-]+$/.test(avdName)) {
      console.log(
        'Invalid AVD name. AVD names must contain only alphanumeric characters, underscores, hyphens, and dots.',
      );
      return;
    }

    console.log(`Opening Android Emulator: ${avdName}`);

    const emulator = spawn(emulatorPath, ['-avd', avdName], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    emulator.unref();
  };

  const handleClearCache = () => {
    console.log('Clearing cache...');
    onClearCache();
    console.log('Cache cleared');
  };

  // Set up key press handler
  // Note: setEncoding('utf8') means data event receives string, not Buffer
  const dataHandler = (chunk: string | Buffer) => {
    const key = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    handleKeyPress(key);
  };

  process.stdin.on('data', dataHandler);

  // Debug: confirm terminal actions are ready
  console.log('[Terminal] Keyboard shortcuts active (raw mode:', process.stdin.isRaw, ')');

  // Cleanup function
  const cleanup = () => {
    process.stdin.removeListener('data', dataHandler);
    if (!wasRaw && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  };

  return cleanup;
}

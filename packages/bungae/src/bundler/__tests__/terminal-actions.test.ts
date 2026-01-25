/**
 * Terminal Actions Tests
 *
 * Tests for terminal keyboard shortcuts handler
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTerminalActions, type TerminalActionsOptions } from '../graph-bundler/terminal-actions';

describe('Terminal Actions', () => {
  let originalStdin: any;
  let mockBroadcast: ReturnType<typeof mock>;
  let mockOnClearCache: ReturnType<typeof mock>;
  let mockStdin: any;

  beforeEach(() => {
    // Mock stdin
    originalStdin = process.stdin;
    mockStdin = {
      isTTY: true,
      isRaw: false,
      isPaused: () => false,
      setRawMode: mock(() => {}),
      resume: mock(() => {}),
      pause: mock(() => {}),
      setEncoding: mock(() => {}),
      on: mock(() => {}),
      removeListener: mock(() => {}),
      removeAllListeners: mock(() => {}),
      listenerCount: mock(() => 0),
    };
    (process as any).stdin = mockStdin;

    // Mock broadcast function
    mockBroadcast = mock(() => {});

    // Mock clear cache callback
    mockOnClearCache = mock(() => {});
  });

  afterEach(() => {
    // Restore original stdin
    (process as any).stdin = originalStdin;
  });

  describe('setupTerminalActions', () => {
    test('should return no-op cleanup when disabled', () => {
      const options: TerminalActionsOptions = {
        enabled: false,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      const cleanup = setupTerminalActions(options);
      expect(cleanup).toBeDefined();
      expect(typeof cleanup).toBe('function');

      // Should not set up any listeners
      expect(mockStdin.setRawMode).not.toHaveBeenCalled();
      expect(mockStdin.on).not.toHaveBeenCalled();
    });

    test('should return no-op cleanup when not a TTY', () => {
      mockStdin.isTTY = false;

      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      const cleanup = setupTerminalActions(options);
      expect(cleanup).toBeDefined();

      // Should not set up any listeners
      expect(mockStdin.setRawMode).not.toHaveBeenCalled();
      expect(mockStdin.on).not.toHaveBeenCalled();
    });

    test('should set up terminal actions when enabled and TTY', () => {
      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      const cleanup = setupTerminalActions(options);
      expect(cleanup).toBeDefined();

      // Should set raw mode
      expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);
      expect(mockStdin.resume).toHaveBeenCalled();
      expect(mockStdin.setEncoding).toHaveBeenCalledWith('utf8');
      expect(mockStdin.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    test('should not set raw mode if already raw', () => {
      mockStdin.isRaw = true;

      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      setupTerminalActions(options);

      // Should not call setRawMode if already raw
      expect(mockStdin.setRawMode).not.toHaveBeenCalled();
    });

    test('should call cleanup and restore raw mode', () => {
      mockStdin.isRaw = false;

      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      const cleanup = setupTerminalActions(options);
      expect(cleanup).toBeDefined();

      // After cleanup, should restore raw mode
      mockStdin.isRaw = true; // Simulate raw mode was set
      cleanup();

      expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
      expect(mockStdin.pause).toHaveBeenCalled();
      expect(mockStdin.removeListener).toHaveBeenCalled();
    });

    test('should not restore raw mode if it was already raw', () => {
      mockStdin.isRaw = true; // Already raw before setup

      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      const cleanup = setupTerminalActions(options);
      cleanup();

      // Should not call setRawMode(false) if it was already raw
      expect(mockStdin.setRawMode).not.toHaveBeenCalledWith(false);
    });
  });

  describe('keyboard shortcuts', () => {
    let dataHandler: ((key: string) => void) | null = null;

    beforeEach(() => {
      // Capture the data handler
      mockStdin.on = mock((event: string, handler: (key: string) => void) => {
        if (event === 'data') {
          dataHandler = handler;
        }
      });
    });

    test('should handle "r" key for reload', () => {
      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      setupTerminalActions(options);
      expect(dataHandler).toBeDefined();

      // Simulate 'r' key press
      dataHandler!('r');

      // Should call broadcast with 'reload'
      expect(mockBroadcast).toHaveBeenCalledWith('reload');
    });

    test('should handle "d" key for dev menu', () => {
      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      setupTerminalActions(options);
      expect(dataHandler).toBeDefined();

      // Simulate 'd' key press
      dataHandler!('d');

      // Should call broadcast with 'devMenu'
      expect(mockBroadcast).toHaveBeenCalledWith('devMenu');
    });

    test('should handle "c" key for clear cache', () => {
      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      setupTerminalActions(options);
      expect(dataHandler).toBeDefined();

      // Simulate 'c' key press
      dataHandler!('c');

      // Should call onClearCache
      expect(mockOnClearCache).toHaveBeenCalled();
    });

    test('should handle uppercase keys', () => {
      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      setupTerminalActions(options);
      expect(dataHandler).toBeDefined();

      // Simulate 'R' key press (uppercase)
      dataHandler!('R');

      // Should call broadcast with 'reload' (case-insensitive)
      expect(mockBroadcast).toHaveBeenCalledWith('reload');
    });

    test('should handle Ctrl+C', () => {
      const mockKill = mock(() => {});
      const originalKill = process.kill;
      (process as any).kill = mockKill;

      // Set isRaw to true so that setRawMode(false) is called
      mockStdin.isRaw = true;

      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      setupTerminalActions(options);
      expect(dataHandler).toBeDefined();

      // Simulate Ctrl+C
      dataHandler!('\u0003');

      // Should call process.kill with SIGINT
      expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGINT');
      expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
      expect(mockStdin.removeListener).toHaveBeenCalled();

      // Restore
      (process as any).kill = originalKill;
    });

    test('should handle Ctrl+D', () => {
      const mockKill = mock(() => {});
      const originalKill = process.kill;
      (process as any).kill = mockKill;

      // Set isRaw to true so that setRawMode(false) is called
      mockStdin.isRaw = true;

      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      setupTerminalActions(options);
      expect(dataHandler).toBeDefined();

      // Simulate Ctrl+D
      dataHandler!('\u0004');

      // Should call process.kill with SIGTERM
      expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
      expect(mockStdin.removeListener).toHaveBeenCalled();

      // Restore
      (process as any).kill = originalKill;
    });

    test('should ignore unknown keys', () => {
      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        broadcast: mockBroadcast,
      };

      setupTerminalActions(options);
      expect(dataHandler).toBeDefined();

      // Clear previous calls
      mockBroadcast.mockClear();
      mockOnClearCache.mockClear();

      // Simulate unknown key
      dataHandler!('x');

      // Should not call any handlers
      expect(mockBroadcast).not.toHaveBeenCalled();
      expect(mockOnClearCache).not.toHaveBeenCalled();
    });

    test('should work without broadcast function', () => {
      const options: TerminalActionsOptions = {
        enabled: true,
        hmrClients: new Set(),
        onClearCache: mockOnClearCache,
        projectRoot: '/test',
        port: 8081,
        // broadcast is optional
      };

      setupTerminalActions(options);
      expect(dataHandler).toBeDefined();

      // Should not throw when broadcast is undefined
      expect(() => {
        dataHandler!('r');
      }).not.toThrow();
    });
  });
});

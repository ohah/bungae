/**
 * HMR Client for React Native
 *
 * Replaces React Native's built-in HMRClient.js.
 * Manages WebSocket connection to the dev server and displays
 * loading/error UI via React Native's DevLoadingView and LogBox.
 *
 * This file is compiled to JS and injected via the hmr-client-replace plugin,
 * which intercepts the `load` of RN's HMRClient.js module.
 */

declare var __DEV__: boolean;
declare var __rolldown_runtime__: any;

// RN native modules accessed dynamically to avoid import resolution issues
declare var __turboModuleProxy: (moduleName: string) => any;


interface HMRClientNativeInterface {
  enable(): void;
  disable(): void;
  registerBundle(requestUrl: string): void;
  log(level: string, data: any[]): void;
  setup(
    platform: string,
    bundleEntry: string,
    host: string,
    port: number | string,
    isEnabled: boolean,
    scheme?: string,
  ): void;
}

function getDevLoadingView() {
  try {
    return require('react-native/Libraries/Utilities/DevLoadingView');
  } catch {
    return null;
  }
}

function getLogBox() {
  try {
    return require('react-native/Libraries/LogBox/LogBox');
  } catch {
    return null;
  }
}

class HMRClient implements HMRClientNativeInterface {
  private enabled = true;
  private _socket: WebSocket | null = null;
  private _origin: string | null = null;
  private compileErrorMessage: string | null = null;
  private pendingUpdatesCount = 0;

  enable() {
    if (this._socket == null) {
      throw new Error('Expected HMRClient.setup() call at startup');
    }
    this.enabled = true;
    this.showCompileErrorIfNeeded();
  }

  disable() {
    this.enabled = false;
  }

  registerBundle(_requestUrl: string) {
    // No-op for Bungae HMR runtime
  }

  log(_level: string, _data: any[]) {
    // Forward logs via WebSocket if needed
  }

  setup(
    platform: string,
    bundleEntry: string,
    host: string,
    port: number | string,
    isEnabled = true,
    protocol = 'http',
  ) {
    if (!__DEV__) {
      throw new Error('HMR is only available in development mode');
    }

    if (this._socket != null) {
      throw new Error('Cannot initialize HMRClient more than once');
    }

    const serverHost = port !== null && port !== '' ? `${host}:${port}` : host;
    const origin = `${protocol}://${serverHost}`;
    this._origin = origin;

    const socket = new globalThis.WebSocket(`${origin}/hot`);
    this._socket = socket;

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({ type: 'hmr:connected', bundleEntry, platform }),
      );
    });

    socket.addEventListener('error', (event: any) => {
      console.warn('[HMR] WebSocket connection error:', event.error?.message || 'unknown');
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(JSON.parse(event.data));
    });

    socket.addEventListener('close', () => {
      const DevLoadingView = getDevLoadingView();
      if (DevLoadingView) {
        DevLoadingView.hide();
        DevLoadingView.showMessage('Fast Refresh disconnected. Reload app to reconnect.', 'error', {
          dismissButton: true,
        });
      }
    });

    // Connect runtime to socket for HMR code evaluation
    if (globalThis.__rolldown_runtime__ != null) {
      globalThis.__rolldown_runtime__.setup(socket, origin);
    }

    this.enabled = isEnabled;
  }

  private handleMessage(data: any) {
    if (!this.enabled && typeof data.type === 'string' && data.type.startsWith('hmr:')) {
      return;
    }

    const DevLoadingView = getDevLoadingView();
    const LogBox = getLogBox();

    switch (data.type) {
      case 'hmr:update-start':
        this.pendingUpdatesCount++;
        this.compileErrorMessage = null;
        if (DevLoadingView) {
          DevLoadingView.showMessage('Refreshing...', 'refresh');
        }
        break;

      case 'hmr:update':
        if (LogBox) {
          LogBox.clearAllLogs();
        }
        break;

      case 'hmr:update-done':
        this.pendingUpdatesCount = Math.max(0, this.pendingUpdatesCount - 1);
        if (this.pendingUpdatesCount === 0 && DevLoadingView) {
          DevLoadingView.hide();
        }
        break;

      case 'hmr:error':
        this.compileErrorMessage = data.payload?.message;
        this.showCompileErrorIfNeeded();
        break;

      case 'hmr:reload':
        // Full reload is handled by the runtime's message handler
        break;
    }
  }

  private showCompileErrorIfNeeded() {
    if (this.compileErrorMessage == null) return;

    const error = new Error(this.compileErrorMessage);
    this.compileErrorMessage = null;
    Object.defineProperty(error, 'preventSymbolication', { value: true });
    throw error;
  }
}

const instance = new HMRClient();

// Compatible with both ESM default import and CJS require
export default Object.defineProperty(instance, 'default', {
  get: () => instance,
});

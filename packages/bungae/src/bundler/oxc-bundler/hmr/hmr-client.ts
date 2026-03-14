/**
 * HMR Client for React Native (metro-runtime HMRClient API compatible)
 *
 * Replaces metro-runtime's HMRClient.js with Bungae's implementation
 * that integrates with Rolldown DevEngine for HMR patches.
 *
 * Must match the metro-runtime HMRClient API:
 *   new HMRClient(url)       — constructor with WebSocket URL
 *   client.on(event, cb)     — event listener
 *   client.send(data)        — send to server
 *   client.enable() / disable() / isEnabled()
 *   client.hasPendingUpdates()
 *
 * Events emitted: connection-error, update-start, update, error, close
 */

declare var __DEV__: boolean;
declare var __rolldown_runtime__: any;

type EventCallback = (...args: any[]) => void;

class HMRClient {
  private _ws: WebSocket;
  private _listeners: Map<string, EventCallback[]> = new Map();
  private _enabled = true;
  private _pendingUpdates = 0;
  private _connected = false;

  constructor(url: string) {
    const ws = new globalThis.WebSocket(url);
    this._ws = ws;

    ws.addEventListener('open', () => {
      this._connected = true;

      // Integrate with Rolldown runtime for module registration
      if (typeof __rolldown_runtime__ !== 'undefined' && __rolldown_runtime__ != null) {
        __rolldown_runtime__.setup(ws, url.replace('/hot', ''));
      }
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        this._handleMessage(data);
      } catch {}
    });

    ws.addEventListener('error', (event: any) => {
      this._emit('connection-error', event.error || new Error('WebSocket error'));
    });

    ws.addEventListener('close', () => {
      this._connected = false;
      this._emit('close');
    });
  }

  on(event: string, callback: EventCallback): void {
    const list = this._listeners.get(event) || [];
    list.push(callback);
    this._listeners.set(event, list);
  }

  off(event: string, callback: EventCallback): void {
    const list = this._listeners.get(event);
    if (list) {
      this._listeners.set(
        event,
        list.filter((cb) => cb !== callback),
      );
    }
  }

  send(data: string): void {
    if (this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(data);
    }
  }

  enable(): void {
    this._enabled = true;
  }

  disable(): void {
    this._enabled = false;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  hasPendingUpdates(): boolean {
    return this._pendingUpdates > 0;
  }

  private _emit(event: string, ...args: any[]): void {
    const list = this._listeners.get(event);
    if (list) {
      for (const cb of list) {
        try {
          cb(...args);
        } catch {}
      }
    }
  }

  private _handleMessage(data: any): void {
    console.log('[HMR-CLIENT] message:', data.type, data.code ? `(${data.code.length} chars)` : '');
    switch (data.type) {
      case 'hmr:update-start':
        this._pendingUpdates++;
        this._emit('update-start', { isInitialUpdate: data.isInitialUpdate || false });
        break;

      case 'hmr:update':
        // Evaluate patch code via Rolldown runtime
        if (
          typeof __rolldown_runtime__ !== 'undefined' &&
          __rolldown_runtime__ != null &&
          data.code
        ) {
          try {
            if (globalThis.globalEvalWithSourceUrl) {
              globalThis.globalEvalWithSourceUrl(data.code);
            } else {
              (0, eval)(data.code);
            }
          } catch (e) {
            this._emit('error', e);
            return;
          }
        }
        this._emit('update', {
          added: data.added || [],
          modified: data.modified || [],
          deleted: data.deleted || [],
        });
        break;

      case 'hmr:update-done':
        this._pendingUpdates = Math.max(0, this._pendingUpdates - 1);
        this._emit('update-done');
        break;

      case 'hmr:error':
        this._emit('error', {
          type: data.payload?.type || 'BuildError',
          message: data.payload?.message || 'Unknown error',
          errors: data.payload?.errors || [],
        });
        break;

      case 'hmr:reload':
        // Trigger full reload
        try {
          const moduleName = 'DevSettings';
          const DevSettings =
            typeof __turboModuleProxy !== 'undefined'
              ? __turboModuleProxy(moduleName)
              : globalThis.nativeModuleProxy?.[moduleName];
          if (DevSettings?.reload) {
            DevSettings.reload();
          }
        } catch {}
        break;
    }
  }
}

declare var __turboModuleProxy: (name: string) => any;

module.exports = HMRClient;

/**
 * HMR Runtime for React Native
 *
 * Client-side HMR implementation injected into the bundle in dev mode.
 * Handles WebSocket connection to the dev server and applies HMR updates.
 *
 * This replaces RN's built-in HMRClient.js since Metro's protocol
 * is incompatible with Rolldown's ESM scope-hoisted output.
 */

declare global {
  var __rolldown_runtime__: any;
  var __turboModuleProxy: (moduleName: string) => any;
  var nativeModuleProxy: Record<string, any>;
  var globalEvalWithSourceUrl: (code: string, sourceURL?: string) => void;
}

// DO NOT EDIT THIS CLASS NAME (`DevRuntime`)
declare const DevRuntime: any;

const BaseDevRuntime = DevRuntime;

class ModuleHotContext {
  acceptCallbacks: Array<{ deps: string[]; fn: (exports: any) => void }> = [];

  constructor(
    private moduleId: string,
    private socketSend: (msg: string) => void,
  ) {}

  accept(...args: any[]) {
    if (args.length === 1) {
      this.acceptCallbacks.push({
        deps: [this.moduleId],
        fn: args[0],
      });
    }
    // accept() with no args = self-accepting
  }

  invalidate() {
    this.socketSend(JSON.stringify({ type: 'hmr:invalidate', moduleId: this.moduleId }));
  }

  cleanup() {
    this.acceptCallbacks.length = 0;
  }
}

class ReactNativeDevRuntime extends BaseDevRuntime {
  private _socket: WebSocket | null = null;
  private _queuedMessages: string[] = [];
  moduleHotContexts = new Map<string, ModuleHotContext>();

  constructor() {
    const messenger = {
      send: (message: any) => this.send(JSON.stringify(message)),
    };
    super(messenger);
  }

  createModuleHotContext(moduleId: string) {
    const ctx = new ModuleHotContext(moduleId, (msg) => this.send(msg));
    this.moduleHotContexts.set(moduleId, ctx);
    return ctx;
  }

  applyUpdates(boundaries: [string, string][]) {
    for (const [moduleId] of boundaries) {
      const ctx = this.moduleHotContexts.get(moduleId);
      if (ctx) {
        for (const cb of ctx.acceptCallbacks) {
          cb.fn(this.modules[moduleId]?.exports);
        }
        ctx.cleanup();
      }
    }
  }

  setup(socket: WebSocket, _origin: string) {
    if (this._socket != null) {
      console.warn('[HMR] Runtime already initialized');
      return;
    }

    this._socket = socket;
    this.flushQueue();

    socket.addEventListener('message', (event: MessageEvent) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'hmr:update':
          this.evaluate(message.code);
          break;

        case 'hmr:reload':
          this.reload();
          break;

        case 'hmr:error':
          console.error('[HMR] Build error:', message.payload?.message);
          break;
      }
    });
  }

  private send(msg: string) {
    if (!this._socket || this._socket.readyState !== WebSocket.OPEN) {
      this._queuedMessages.push(msg);
      return;
    }
    this._socket.send(msg);
  }

  private flushQueue() {
    if (!this._socket) return;
    for (const msg of this._queuedMessages) {
      this._socket.send(msg);
    }
    this._queuedMessages.length = 0;
  }

  private evaluate(code: string) {
    if (globalThis.globalEvalWithSourceUrl) {
      globalThis.globalEvalWithSourceUrl(code);
    } else {
      // eslint-disable-next-line no-eval
      eval(code);
    }
  }

  private reload() {
    const moduleName = 'DevSettings';
    (globalThis.__turboModuleProxy
      ? globalThis.__turboModuleProxy(moduleName)
      : globalThis.nativeModuleProxy[moduleName]
    ).reload();
  }
}

globalThis.__rolldown_runtime__ = new ReactNativeDevRuntime();

export type { ReactNativeDevRuntime };

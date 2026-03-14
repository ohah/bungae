/**
 * HMR Runtime for React Native (Rolldown DevEngine)
 *
 * Client-side HMR implementation injected into the bundle via devMode.implement.
 *
 * IMPORTANT: The `implement` code runs in the IIFE scope but DevRuntime/Module
 * classes defined by Rolldown's runtime are NOT accessible from this scope
 * (Hermes cannot resolve them). So we build the runtime object from scratch
 * using only the top-level helpers (__toESM, __toCommonJS, etc.) which ARE
 * accessible as var declarations in the same IIFE.
 */

// These are declared by Rolldown's runtime as `var` in the same IIFE scope.
// We reference them via `declare` so TypeScript doesn't complain.
declare var __toESM: any;
declare var __toCommonJS: any;
declare var __exportAll: any;
declare var __reExport: any;
declare var __esmMin: any;
declare var __commonJSMin: any;
declare var __esmMin_debug_last: string;

declare global {
  var __rolldown_runtime__: any;
  var __turboModuleProxy: (moduleName: string) => any;
  // Used at line 198 via globalThis.nativeModuleProxy
  var nativeModuleProxy: Record<string, any>;
  var globalEvalWithSourceUrl: (code: string, sourceURL?: string) => void;
  var __ReactRefresh: any;
}

// --- Module tracking ---

var _modules: Record<string, { id: string; exportsHolder: { exports: any } }> = {};

function runtimeRegisterModule(id: string, exportsHolder: { exports: any }): void {
  _modules[id] = { id: id, exportsHolder: exportsHolder };
  // DEBUG: Track last registered module for error diagnosis
  if (typeof __esmMin_debug_last !== 'undefined') {
    __esmMin_debug_last = id;
  }
  sendModuleRegistered(id);
}

function runtimeLoadExports(id: string): any {
  var mod = _modules[id];
  if (mod) {
    return mod.exportsHolder.exports;
  } else {
    console.warn('Module ' + id + ' not found');
    return {};
  }
}

// Batched module registration messages
var _regCache: string[] = [];
var _regTimeout: ReturnType<typeof setTimeout> | null = null;
var _regSetLength = 0;

function sendModuleRegistered(moduleId: string): void {
  _regCache.push(moduleId);
  if (!_regTimeout) {
    _regTimeout = setTimeout(function flushReg() {
      if (_regCache.length > _regSetLength) {
        _regTimeout = setTimeout(flushReg);
        _regSetLength = _regCache.length;
        return;
      }
      send(JSON.stringify({ type: 'hmr:module-registered', modules: _regCache }));
      _regCache = [];
      _regTimeout = null;
      _regSetLength = 0;
    });
    _regSetLength = _regCache.length;
  }
}

// --- React Refresh ---

function isReactRefreshBoundary(moduleExports: Record<string, any>): boolean {
  var ReactRefresh = globalThis.__ReactRefresh;
  if (!ReactRefresh) return false;

  if (typeof moduleExports === 'function') {
    return ReactRefresh.isLikelyComponentType(moduleExports);
  }

  if (typeof moduleExports === 'object' && moduleExports !== null) {
    var hasDefaultExport = 'default' in moduleExports;
    var hasNonComponentExport = false;

    var keys = Object.keys(moduleExports);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]!;
      if (key === '__esModule') continue;
      var val = moduleExports[key];
      if (typeof val === 'function' && !ReactRefresh.isLikelyComponentType(val)) {
        hasNonComponentExport = true;
      }
    }

    if (hasDefaultExport && !hasNonComponentExport) {
      return true;
    }
  }

  return false;
}

var pendingUpdates = 0;
var refreshTimeout: ReturnType<typeof setTimeout> | null = null;

function enqueueUpdate(): void {
  pendingUpdates++;
  if (refreshTimeout != null) {
    clearTimeout(refreshTimeout);
  }
  refreshTimeout = setTimeout(function () {
    refreshTimeout = null;
    var updates = pendingUpdates;
    pendingUpdates = 0;
    if (updates > 0) {
      var ReactRefresh = globalThis.__ReactRefresh;
      if (ReactRefresh) {
        try {
          ReactRefresh.performReactRefresh();
        } catch (error) {
          console.error('[HMR] React Refresh failed:', error);
        }
      }
    }
  }, 50);
}

// --- Module hot context (import.meta.hot) ---

function createModuleHotCtx(moduleId: string, socketSend: (msg: string) => void) {
  var acceptCallbacks: Array<{ deps: string[]; fn: (exports: any) => void }> = [];

  return {
    get refresh() {
      return globalThis.__ReactRefresh;
    },
    get refreshUtils() {
      return {
        isReactRefreshBoundary: isReactRefreshBoundary,
        enqueueUpdate: enqueueUpdate,
      };
    },
    acceptCallbacks: acceptCallbacks,
    accept: function (...args: any[]) {
      if (args.length === 1) {
        acceptCallbacks.push({ deps: [moduleId], fn: args[0] });
      }
    },
    invalidate: function () {
      socketSend(JSON.stringify({ type: 'hmr:invalidate', moduleId: moduleId }));
    },
    cleanup: function () {
      acceptCallbacks.length = 0;
    },
  };
}

// --- WebSocket communication ---

var _socket: WebSocket | null = null;
var _queuedMessages: string[] = [];
var moduleHotContexts = new Map<string, ReturnType<typeof createModuleHotCtx>>();

function send(msg: string): void {
  if (!_socket || _socket.readyState !== WebSocket.OPEN) {
    _queuedMessages.push(msg);
    return;
  }
  _socket.send(msg);
}

function flushQueue(): void {
  if (!_socket) return;
  for (var i = 0; i < _queuedMessages.length; i++) {
    _socket.send(_queuedMessages[i]!);
  }
  _queuedMessages.length = 0;
}

function evaluate(code: string): void {
  if (globalThis.globalEvalWithSourceUrl) {
    globalThis.globalEvalWithSourceUrl(code);
  } else {
    // eslint-disable-next-line no-eval
    eval(code);
  }
}

function reload(): void {
  var moduleName = 'DevSettings';
  (globalThis.__turboModuleProxy
    ? globalThis.__turboModuleProxy(moduleName)
    : globalThis.nativeModuleProxy[moduleName]
  ).reload();
}

// --- Build the runtime object from scratch ---
// DevRuntime class from Rolldown's runtime is NOT accessible in implement scope.
// We replicate its interface using the same top-level helpers that ARE accessible.

var clientId = 'bungae-' + Date.now();

var __rolldown_runtime__: any = {
  // Module registry
  modules: _modules,
  clientId: clientId,
  messenger: {
    send: function (message: any) {
      send(JSON.stringify(message));
    },
  },

  // Core module system methods
  registerModule: runtimeRegisterModule,
  loadExports: runtimeLoadExports,

  // ESM/CJS initializer helpers (same as DevRuntime constructor)
  createEsmInitializer: function (fn: any, res: any) {
    return function () {
      return (fn && (res = fn((fn = 0))), res);
    };
  },
  createCjsInitializer: function (cb: any, mod: any) {
    return function () {
      return (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
    };
  },

  // Module system helpers — these reference the top-level IIFE vars
  __toESM: typeof __toESM !== 'undefined' ? __toESM : undefined,
  __toCommonJS: typeof __toCommonJS !== 'undefined' ? __toCommonJS : undefined,
  __exportAll: typeof __exportAll !== 'undefined' ? __exportAll : undefined,
  __reExport: typeof __reExport !== 'undefined' ? __reExport : undefined,
  __toDynamicImportESM: function (isNodeMode?: boolean) {
    return function (mod: any) {
      return typeof __toESM !== 'undefined' ? __toESM(mod.default, isNodeMode) : mod;
    };
  },

  // HMR methods
  createModuleHotContext: function (moduleId: string) {
    var ctx = createModuleHotCtx(moduleId, send);
    moduleHotContexts.set(moduleId, ctx);
    return ctx;
  },

  applyUpdates: function (boundaries: [string, string][]) {
    for (var i = 0; i < boundaries.length; i++) {
      var moduleId = boundaries[i]![0];
      var mod = _modules[moduleId];
      var ctx = moduleHotContexts.get(moduleId);
      if (ctx) {
        for (var j = 0; j < ctx.acceptCallbacks.length; j++) {
          ctx.acceptCallbacks[j]!.fn(mod?.exportsHolder?.exports);
        }
        ctx.cleanup();
      }
    }
  },

  sendModuleRegisteredMessage: sendModuleRegistered,

  // Custom properties
  moduleHotContexts: moduleHotContexts,

  setup: function (socket: WebSocket, _origin: string) {
    if (_socket != null) {
      console.warn('[HMR] Runtime already initialized');
      return;
    }

    _socket = socket;
    flushQueue();

    socket.addEventListener('message', function (event: MessageEvent) {
      var message = JSON.parse(event.data);

      switch (message.type) {
        case 'hmr:update':
          evaluate(message.code);
          break;

        case 'hmr:reload':
          reload();
          break;

        case 'hmr:error':
          console.error('[HMR] Build error:', message.payload?.message);
          break;
      }
    });
  },
};

// Also set on globalThis for external access
globalThis.__rolldown_runtime__ = __rolldown_runtime__;

export type ReactNativeDevRuntime = typeof __rolldown_runtime__;

/**
 * Bungae HMR Client - Metro-compatible replacement for react-native/Libraries/Utilities/HMRClient.js
 * Used when graph-bundler serves the bundle (InitializeCore + normal graph + HMR only replacement).
 * Connects to Bungae dev server WebSocket and applies Metro-format HMR updates.
 */
'use strict';

var STARTUP_ERROR = 'Expected HMRClient.setup() call at startup';
var MAX_PENDING_LOGS = 100;

function inject(moduleEntry) {
  var code = moduleEntry.module[1];
  var sourceURL = moduleEntry.sourceURL;
  if (typeof global !== 'undefined' && global.globalEvalWithSourceUrl) {
    global.globalEvalWithSourceUrl(code, sourceURL);
  } else {
    // eslint-disable-next-line no-eval
    eval(code);
  }
}

function injectUpdate(update) {
  if (update.added) {
    for (var i = 0; i < update.added.length; i++) {
      inject(update.added[i]);
    }
  }
  if (update.modified) {
    for (var j = 0; j < update.modified.length; j++) {
      inject(update.modified[j]);
    }
  }
}

var HMRClient = {
  _enabled: true,
  _socket: null,
  _pendingLogs: [],

  enable: function () {
    if (this._socket == null) {
      throw new Error(STARTUP_ERROR);
    }
    this._enabled = true;
  },

  disable: function () {
    this._enabled = false;
  },

  registerBundle: function (_requestUrl) {
    if (this._socket == null) {
      throw new Error(STARTUP_ERROR);
    }
    // Optional: validate origin; Bungae does not require extra handling
  },

  log: function (level, data) {
    if (this._socket == null || this._socket.readyState !== 1) {
      this._pendingLogs.push([level, data]);
      if (this._pendingLogs.length > MAX_PENDING_LOGS) {
        this._pendingLogs.shift();
      }
      return;
    }
    try {
      this._socket.send(JSON.stringify({ type: 'hmr:log', level: level, data: data }));
    } catch {}
  },

  setup: function (platform, bundleEntry, host, port, isEnabled, scheme) {
    if (typeof __DEV__ !== 'undefined' && !__DEV__) {
      throw new Error('HMR is only available in development mode');
    }
    if (this._socket != null) {
      throw new Error('Cannot initialize HMRClient more than once');
    }
    if (platform == null || bundleEntry == null || host == null) {
      throw new Error('Missing required parameter for HMRClient.setup()');
    }
    var protocol = scheme === 'https' ? 'wss' : 'ws';
    var portPart = port != null && port !== '' ? ':' + port : '';
    var wsUrl = protocol + '://' + host + portPart + '/hot';
    var socket = new (typeof WebSocket !== 'undefined' ? WebSocket : global.WebSocket)(wsUrl);
    this._socket = socket;
    this._enabled = isEnabled !== false;

    var self = this;
    socket.onopen = function () {
      socket.send(
        JSON.stringify({
          type: 'hmr:connected',
          bundleEntry: bundleEntry,
          platform: platform,
        }),
      );
      for (var i = 0; i < self._pendingLogs.length; i++) {
        var entry = self._pendingLogs[i];
        try {
          socket.send(
            JSON.stringify({
              type: 'hmr:log',
              level: entry[0],
              data: entry[1],
            }),
          );
        } catch {}
      }
      self._pendingLogs.length = 0;
    };

    socket.onmessage = function (event) {
      try {
        var data = JSON.parse(event.data);
        var type = data.type;
        var body = data.body;
        if (!self._enabled && type !== 'error') {
          return;
        }
        switch (type) {
          case 'update-start':
            break;
          case 'update':
            if (body && (body.added || body.modified)) {
              injectUpdate(body);
            }
            break;
          case 'update-done':
            break;
          case 'error':
            if (body && body.message) {
              console.error('[Bungae HMR]', body.message);
            }
            break;
          default:
            break;
        }
      } catch (e) {
        console.warn('[Bungae HMR] Invalid message', e);
      }
    };

    socket.onerror = function (_err) {
      console.warn('[Bungae HMR] WebSocket error');
    };

    socket.onclose = function () {
      self._socket = null;
    };
  },
};

module.exports = HMRClient;

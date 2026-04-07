/**
 * ZTS HMR Client - Metro HMRClient interface replacement for ZTS bundler.
 * Connects to bungae dev server WebSocket and applies ZTS-format HMR updates
 * via __zts_apply_update() (injected by ZTS dev mode runtime).
 */
'use strict';

var HMRClient = {
  _socket: null,
  _enabled: true,

  enable: function () {
    this._enabled = true;
  },

  disable: function () {
    this._enabled = false;
  },

  registerBundle: function (_requestUrl) {
    // No-op: ZTS bundler does not require bundle registration
  },

  log: function (_level, _data) {
    // No-op: ZTS HMR does not forward logs to server
  },

  setup: function (platform, bundleEntry, host, port, isEnabled, scheme) {
    if (this._socket != null) {
      return;
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
    };

    socket.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (!self._enabled && msg.type !== 'hmr:error') {
          return;
        }
        switch (msg.type) {
          case 'hmr:update-start':
            break;
          case 'hmr:update':
            if (typeof __zts_apply_update === 'function' && msg.modules && msg.modules.length > 0) {
              __zts_apply_update(msg.modules);
            }
            break;
          case 'hmr:update-done':
            break;
          case 'hmr:reload':
            // Reuse __zts_reload() from ZTS HMR runtime (injected via --dev mode)
            if (typeof __zts_reload === 'function') {
              __zts_reload();
            } else if (typeof location !== 'undefined') {
              location.reload();
            }
            break;
          case 'hmr:error':
            if (msg.message) {
              console.error('[ZTS HMR]', msg.message);
            }
            break;
          default:
            break;
        }
      } catch (e) {
        console.warn('[ZTS HMR] Invalid message', e);
      }
    };

    socket.onerror = function () {
      console.warn('[ZTS HMR] WebSocket error');
    };

    socket.onclose = function () {
      self._socket = null;
    };
  },
};

// RN의 setUpBatchedBridge가 require('HMRClient').default로 접근하므로 default export 필요
module.exports = HMRClient;
module.exports.default = HMRClient;

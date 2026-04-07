/**
 * coLaB M4L Notifier — minimal dgram bridge to the CoLaB Max device.
 *
 * The CoLaB Max for Live device listens on UDP 8001 (see ~/colab/CLAUDE.md
 * "UDP Command Protocol"). The colab-sync-node.js sender already uses
 * `dgram.send(JSON.stringify(...))` to push delta JSON to that port.
 * This module reuses the same JSON-over-UDP convention to surface
 * non-delta status messages to the M4L console — things like "peer just
 * saved their .als" that don't belong on the parameter sync wire.
 *
 * Wire format (one JSON object per UDP packet) — matches the existing
 * colab_livesync.js single-letter dispatch convention:
 *
 *   {
 *     "u":   "<sender uid>",   // echo prevention on the receiver
 *     "t":   "nf",             // 2-char dispatch code = "notify"
 *     "lv":  "info|warn|err",  // level
 *     "tag": "[INFO]|[WARN]|[ERR]",
 *     "msg": "human-readable message",
 *     "d":   { ... }           // optional structured payload
 *   }
 *
 * The receiver (colab_livesync.js) handles `t === "nf"` in its applyDelta
 * switch and posts `tag + " " + msg` to the Max console. If the receiver
 * doesn't have that case yet, the JSON is silently dropped —
 * notifications are best-effort and never block the actual sync flow.
 *
 * Copyright (c) 2026 Tyler Yianacopolus / Moonwolf. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL — coLaB project original IP.
 *
 * @module m4l-notifier
 * @version 0.1.0
 * @license PROPRIETARY
 */

var dgram = require('dgram');

var DEFAULT_HOST = '127.0.0.1';
var DEFAULT_PORT = 8001;

function M4LNotifier(options) {
  options = options || {};
  this._host = options.host || DEFAULT_HOST;
  this._port = options.port || DEFAULT_PORT;
  this._uid = options.uid || ('engine-' + process.pid);

  // Lazy socket — created on first send. Avoids holding an FD when
  // the engine is configured but never actually notifies.
  this._sock = null;
  this._closed = false;

  this.stats = { sent: 0, errors: 0, bytes: 0 };
}

// ---------------------------------------------------------------------------

M4LNotifier.prototype._ensureSock = function() {
  if (this._sock || this._closed) return;
  try {
    this._sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    var self = this;
    this._sock.on('error', function(err) {
      self.stats.errors++;
      // Best-effort — don't propagate to engine.
    });
  } catch (e) {
    this.stats.errors++;
  }
};

/**
 * Generic JSON send. Returns true if the packet was queued for transmit,
 * false if the notifier is closed or socket creation failed.
 */
M4LNotifier.prototype.send = function(obj) {
  if (this._closed) return false;
  this._ensureSock();
  if (!this._sock) return false;

  if (obj && typeof obj === 'object') {
    if (obj.u === undefined) obj.u = this._uid;
  }

  var msg;
  try {
    msg = Buffer.from(JSON.stringify(obj), 'utf8');
  } catch (e) {
    this.stats.errors++;
    return false;
  }

  try {
    var self = this;
    this._sock.send(msg, 0, msg.length, this._port, this._host, function(err) {
      if (err) self.stats.errors++;
    });
    this.stats.sent++;
    this.stats.bytes += msg.length;
    return true;
  } catch (e) {
    this.stats.errors++;
    return false;
  }
};

/** Convenience: post an [INFO] line to the M4L console. */
M4LNotifier.prototype.info = function(text, data) {
  return this.send({ t: 'nf', lv: 'info', tag: '[INFO]', msg: text, d: data || null });
};

/** Convenience: post a [WARN] line. */
M4LNotifier.prototype.warn = function(text, data) {
  return this.send({ t: 'nf', lv: 'warn', tag: '[WARN]', msg: text, d: data || null });
};

/** Convenience: post an [ERR] line. */
M4LNotifier.prototype.err = function(text, data) {
  return this.send({ t: 'nf', lv: 'err', tag: '[ERR]', msg: text, d: data || null });
};

/** Close the underlying socket. Idempotent. */
M4LNotifier.prototype.close = function() {
  if (this._closed) return;
  this._closed = true;
  if (this._sock) {
    try { this._sock.close(); } catch (e) {}
    this._sock = null;
  }
};

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** Pretty-print a byte count for human messages: "4.2 MB", "812 KB", etc. */
M4LNotifier.formatBytes = function(n) {
  if (typeof n !== 'number' || isNaN(n)) return '? B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

if (typeof module !== 'undefined') {
  module.exports = M4LNotifier;
}

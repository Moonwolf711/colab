/**
 * coLaB ALS Replicator — LAN file-level replication of the .als set.
 *
 * Phase 1 of the "B + C" sync upgrade plan (see ~/tasks/colab-als-sync-plan.md).
 *
 * Flow:
 *   peer A Ableton saves x.als
 *     → als-git.js fs.watch + debounce
 *       → AlsGit.onRawSave(buffer, path) fires
 *         → AlsReplicator.sendSet(buffer, name)
 *           → tcp.sendData( [1 pktType][4 seq][hash 32][nameLen 2][name][bytes] )
 *             └── peer B tcp receives on 'als_set' event
 *                   → AlsReplicator._onRemote(payload)
 *                     → sha256 de-dupe (skip if === last local sha)
 *                     → write to <path>.incoming
 *                     → fsync + rename over <path>  (atomic)
 *                     → emit 'remote_save' with { path, bytes, sha256 }
 *
 * Echo guard:
 *   Every buffer we SEND is hashed and pushed onto a small FIFO of recent
 *   local shas. When an incoming frame's sha matches anything in that FIFO
 *   we drop it — this prevents save-storms when two peers save the exact
 *   same bytes back-to-back (identical after normalization).
 *
 * Size guard:
 *   Aborts with an error emit if the .als exceeds `maxBytes` (default
 *   256 MB — tcp-stack's hard cap is 64 MB per frame, so we must stay
 *   well under that).
 *
 * Conflict strategy (phase 1):
 *   LAST WRITER WINS. If peer A sends bytes while peer B is mid-save,
 *   peer B's .als.incoming gets written, renamed, and the local Ableton
 *   instance ignores the new on-disk state until the user chooses to
 *   reopen. A later phase may add a reload notification.
 *
 * Copyright (c) 2026 Tyler Yianacopolus / Moonwolf. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL — coLaB project original IP.
 *
 * @module als-replicator
 * @version 0.1.0
 * @license PROPRIETARY
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var C = require('../shared/constants');

// ---------------------------------------------------------------------------
// Wire format for an ALS_SET frame (inside the protocol.js 5-byte envelope)
// ---------------------------------------------------------------------------
//
// After the [1 pktType][4 seq] header, the payload is:
//   [32 bytes]   sha256 of the als bytes (binary)
//   [2 bytes LE] nameLen
//   [nameLen]    utf-8 filename (basename only)
//   [remainder]  raw .als bytes
//
// nameLen is bounded to 512 to keep the header cheap.

var SHA_LEN = 32;
var NAME_LEN_BYTES = 2;
var MAX_NAME_LEN = 512;
var MIN_FRAME_BYTES = SHA_LEN + NAME_LEN_BYTES + 1;

var DEFAULT_MAX_ALS_BYTES = 256 * 1024 * 1024; // 256 MB
var DEFAULT_ECHO_FIFO = 8;
var DEFAULT_ECHO_WINDOW_MS = 3000;   // after a local send we ignore remotes with the same sha for 3s
var DEFAULT_LOCAL_SAVE_GRACE_MS = 500; // ignore remote saves that arrive right after a local save

// ---------------------------------------------------------------------------
// AlsReplicator
// ---------------------------------------------------------------------------

function AlsReplicator(options) {
  options = options || {};

  this._tcp = options.tcp || null;                 // TcpStack instance
  this._alsPath = options.alsPath || null;         // absolute path of the .als we own locally
  this._maxBytes = options.maxBytes || DEFAULT_MAX_ALS_BYTES;
  this._echoFifoSize = options.echoFifoSize || DEFAULT_ECHO_FIFO;
  this._echoWindowMs = options.echoWindowMs || DEFAULT_ECHO_WINDOW_MS;
  this._localSaveGraceMs = options.localSaveGraceMs || DEFAULT_LOCAL_SAVE_GRACE_MS;

  // Recent shas FIFO — entries are { sha: hex, at: epochMs }
  this._echoFifo = [];

  // Last local save timestamp — remotes that arrive within the grace
  // window are suppressed regardless of sha.
  this._lastLocalSaveAt = 0;

  // Simple event emitter.
  this._handlers = {};

  // Stats.
  this.stats = {
    sent: 0,
    sentBytes: 0,
    received: 0,
    receivedBytes: 0,
    dropped_echo_sha: 0,
    dropped_grace_window: 0,
    dropped_oversize: 0,
    dropped_no_tcp: 0,
    dropped_not_connected: 0,
    write_errors: 0
  };

  if (this._tcp) {
    this._attachTcp(this._tcp);
  }
}

// ---------------------------------------------------------------------------
// Event bus
// ---------------------------------------------------------------------------

AlsReplicator.prototype.on = function(event, handler) {
  if (!this._handlers[event]) this._handlers[event] = [];
  this._handlers[event].push(handler);
};

AlsReplicator.prototype._emit = function(event, data) {
  var hs = this._handlers[event];
  if (!hs) return;
  for (var i = 0; i < hs.length; i++) {
    try { hs[i](data); } catch (e) {}
  }
};

// ---------------------------------------------------------------------------
// TCP attachment
// ---------------------------------------------------------------------------

AlsReplicator.prototype.attachTcp = function(tcp) {
  this._tcp = tcp;
  this._attachTcp(tcp);
};

AlsReplicator.prototype._attachTcp = function(tcp) {
  var self = this;
  tcp.on('als_set', function(payload) {
    self._onRemote(payload);
  });
};

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Publish a fresh .als snapshot to the peer. ``buffer`` is the raw file
 * bytes; ``alsPath`` (optional) is used only to derive the basename if
 * not already set on this replicator.
 *
 * Returns true if a frame was queued for send, false if it was dropped
 * (oversize, not connected, echo, etc.). The reason is available in
 * ``this.stats``.
 */
AlsReplicator.prototype.sendSet = function(buffer, alsPath) {
  if (!this._tcp) {
    this.stats.dropped_no_tcp++;
    this._emit('drop', { reason: 'no_tcp', bytes: buffer ? buffer.length : 0 });
    return false;
  }
  if (typeof this._tcp.isConnected === 'function' && !this._tcp.isConnected()) {
    this.stats.dropped_not_connected++;
    this._emit('drop', { reason: 'not_connected', bytes: buffer ? buffer.length : 0 });
    return false;
  }
  if (!buffer || buffer.length === 0) {
    this.stats.dropped_oversize++;
    this._emit('drop', { reason: 'empty_buffer', bytes: 0 });
    return false;
  }
  if (buffer.length > this._maxBytes) {
    this.stats.dropped_oversize++;
    this._emit('drop', { reason: 'oversize', bytes: buffer.length, limit: this._maxBytes });
    return false;
  }

  var sha = crypto.createHash('sha256').update(buffer).digest();
  var shaHex = sha.toString('hex');

  // Record for echo guard BEFORE send — we want to drop any remote frame
  // that mirrors this one right back at us.
  this._recordLocalSha(shaHex);
  this._lastLocalSaveAt = Date.now();

  var nameStr = this._basenameFor(alsPath || this._alsPath || 'project.als');
  var nameBuf = Buffer.from(nameStr, 'utf8');
  if (nameBuf.length > MAX_NAME_LEN) {
    nameBuf = nameBuf.slice(0, MAX_NAME_LEN);
  }

  var payload = Buffer.concat([
    sha,
    _u16le(nameBuf.length),
    nameBuf,
    buffer
  ]);

  this._tcp.sendMessage(C.PKT.ALS_SET, payload);

  this.stats.sent++;
  this.stats.sentBytes += buffer.length;
  this._emit('sent', { bytes: buffer.length, sha: shaHex, name: nameStr });
  return true;
};

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

AlsReplicator.prototype._onRemote = function(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < MIN_FRAME_BYTES) {
    this._emit('error', { where: 'onRemote', reason: 'short_frame', len: payload ? payload.length : 0 });
    return;
  }

  var sha = payload.slice(0, SHA_LEN);
  var shaHex = sha.toString('hex');
  var nameLen = payload.readUInt16LE(SHA_LEN);
  var nameStart = SHA_LEN + NAME_LEN_BYTES;
  var nameEnd = nameStart + nameLen;
  if (nameEnd > payload.length || nameLen > MAX_NAME_LEN) {
    this._emit('error', { where: 'onRemote', reason: 'bad_name_len', nameLen: nameLen });
    return;
  }
  var name = payload.slice(nameStart, nameEnd).toString('utf8');
  var bytes = payload.slice(nameEnd);

  // Echo guard: if we recently sent this exact sha, ignore.
  if (this._isRecentLocalSha(shaHex)) {
    this.stats.dropped_echo_sha++;
    this._emit('drop', { reason: 'echo_sha', sha: shaHex, name: name });
    return;
  }

  // Grace window: if we just saved locally, a remote frame arriving
  // inside the grace is likely a race condition and should be dropped
  // rather than clobbering our fresh state. LWW per the plan.
  if (Date.now() - this._lastLocalSaveAt < this._localSaveGraceMs) {
    this.stats.dropped_grace_window++;
    this._emit('drop', { reason: 'grace_window', sha: shaHex, name: name });
    return;
  }

  // Verify sha matches payload.
  var actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== shaHex) {
    this._emit('error', { where: 'onRemote', reason: 'sha_mismatch', expected: shaHex, actual: actual });
    return;
  }

  // Commit to disk.
  var targetPath = this._resolveTargetPath(name);
  if (!targetPath) {
    this._emit('error', { where: 'onRemote', reason: 'no_target_path', name: name });
    return;
  }
  var ok = this._writeAtomic(targetPath, bytes);
  if (!ok) {
    this.stats.write_errors++;
    return;
  }

  this.stats.received++;
  this.stats.receivedBytes += bytes.length;

  // Record this sha so we don't re-emit to peer via our own watcher.
  this._recordLocalSha(shaHex);

  this._emit('remote_save', {
    path: targetPath,
    name: name,
    bytes: bytes.length,
    sha256: shaHex
  });
};

// ---------------------------------------------------------------------------
// Local path / write
// ---------------------------------------------------------------------------

AlsReplicator.prototype.setAlsPath = function(p) {
  this._alsPath = p ? path.resolve(p) : null;
};

AlsReplicator.prototype._resolveTargetPath = function(remoteName) {
  if (this._alsPath) {
    // Always write into OUR local .als path regardless of what the
    // peer called it — the project layout might differ.
    return this._alsPath;
  }
  return null;
};

AlsReplicator.prototype._writeAtomic = function(targetPath, bytes) {
  var dir = path.dirname(targetPath);
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) {
    this._emit('error', { where: '_writeAtomic', reason: 'mkdir', error: e.message });
    return false;
  }
  var tmp = targetPath + '.incoming';
  try {
    var fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, bytes, 0, bytes.length, 0);
    try { fs.fsyncSync(fd); } catch (e) { /* fsync is best-effort */ }
    fs.closeSync(fd);
    fs.renameSync(tmp, targetPath);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (ee) {}
    this._emit('error', { where: '_writeAtomic', reason: 'write', error: e.message, path: targetPath });
    return false;
  }
};

AlsReplicator.prototype._basenameFor = function(p) {
  if (!p) return 'project.als';
  return path.basename(p);
};

// ---------------------------------------------------------------------------
// Echo FIFO
// ---------------------------------------------------------------------------

AlsReplicator.prototype._recordLocalSha = function(shaHex) {
  var now = Date.now();
  this._echoFifo.push({ sha: shaHex, at: now });
  // Bound the FIFO size.
  while (this._echoFifo.length > this._echoFifoSize) {
    this._echoFifo.shift();
  }
  // Also drop anything past the window.
  var cutoff = now - this._echoWindowMs;
  while (this._echoFifo.length > 0 && this._echoFifo[0].at < cutoff) {
    this._echoFifo.shift();
  }
};

AlsReplicator.prototype._isRecentLocalSha = function(shaHex) {
  var cutoff = Date.now() - this._echoWindowMs;
  for (var i = this._echoFifo.length - 1; i >= 0; i--) {
    var entry = this._echoFifo[i];
    if (entry.at < cutoff) continue;
    if (entry.sha === shaHex) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Tiny utils
// ---------------------------------------------------------------------------

function _u16le(n) {
  var b = Buffer.alloc(NAME_LEN_BYTES);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}

// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = AlsReplicator;
}

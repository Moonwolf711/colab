/**
 * coLaB TCP/IP Stack — Reliable, ordered, multiplexed communication over IPv4
 *
 * Full TCP transport for peer-to-peer coLaB sessions on a local network.
 * Replaces the manual ACK/retransmit layer in lan-transport.js with native
 * TCP guarantees while keeping the same event interface.
 *
 * Architecture:
 *   - Length-prefixed framing over TCP stream (no message boundaries in TCP)
 *   - Multiplexed channels over a single connection (state, data, control)
 *   - TCP_NODELAY (Nagle off) for sub-millisecond LAN latency
 *   - Configurable application-level send buffer with backpressure
 *   - Auto-reconnect with exponential backoff
 *   - Compatible with protocol.js packet format (drop-in for hub-main.js)
 *
 * Wire format per frame:
 *   [4 bytes LE: payload length] [1 byte: channel] [N bytes: payload]
 *   Payload is the standard protocol.js format: [1 type][4 seq][...data]
 *
 * Copyright (c) 2026 Tyler Yianacopolus / Moonwolf. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL — coLaB project original IP.
 *
 * @module tcp-stack
 * @version 1.0.0
 * @license PROPRIETARY
 */

var net = require('net');
var C = require('../shared/constants');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var FRAME_HEADER_LEN = 5;   // 4 bytes length + 1 byte channel
var MAX_FRAME_SIZE = 64 * 1024 * 1024;  // 64MB hard cap per frame
var DEFAULT_SEND_BUFFER = 256 * 1024;   // 256KB application send buffer
var MIN_SEND_BUFFER = 16 * 1024;        // 16KB minimum
var MAX_SEND_BUFFER = 16 * 1024 * 1024; // 16MB maximum

var RECONNECT_BASE_MS = 500;
var RECONNECT_MAX_MS = 15000;
var RECONNECT_JITTER = 200;

var KEEPALIVE_INTERVAL_MS = 2000;
var KEEPALIVE_TIMEOUT_MS = 6000;

// Channel IDs (multiplexed over single TCP connection)
var CH = {
  STATE:   0x00,  // CRDT diffs, cursor updates — high frequency, small
  DATA:    0x01,  // file transfers, manifests — large, bursty
  CONTROL: 0x02,  // heartbeat, connect/disconnect, flow control
  AUDIO:   0x03   // audio stream (if TCP fallback needed)
};

// ---------------------------------------------------------------------------
// TcpStack
// ---------------------------------------------------------------------------

function TcpStack(options) {
  options = options || {};

  // --- configurable send buffer (bytes) ---
  this.sendBufferSize = clamp(
    options.sendBufferSize || DEFAULT_SEND_BUFFER,
    MIN_SEND_BUFFER, MAX_SEND_BUFFER
  );

  // Port
  this._port = options.port || C.TCP_PORT || 4260;

  // Mode: 'server' (listen) or 'client' (connect) — set by listen()/connect()
  this._mode = null;

  // Server
  this._server = null;

  // Connection state
  this._socket = null;
  this._connected = false;
  this._peerAddress = null;
  this._peerPort = null;

  // Receive buffer (TCP stream reassembly)
  this._recvBuf = null;
  this._recvBufLen = 0;
  this._recvBufAlloc = 0;

  // Send queue with backpressure
  this._sendQueue = [];
  this._sendQueueBytes = 0;
  this._draining = false;

  // Sequencing
  this._txSeq = 0;

  // Keepalive / heartbeat
  this._keepaliveTimer = null;
  this._lastRecvTime = 0;
  this._keepaliveCheckTimer = null;

  // Reconnect
  this._reconnectEnabled = options.reconnect !== false;
  this._reconnectAttempt = 0;
  this._reconnectTimer = null;
  this._reconnectTarget = null; // { host, port }

  // RTT measurement
  this.rttMs = 0;
  this._pingPending = false;
  this._pingSentAt = 0;

  // Bandwidth metering
  this._bytesSent = 0;
  this._bytesRecv = 0;
  this._bwStart = Date.now();
  this.sendBps = 0;
  this.recvBps = 0;
  this._bwTimer = null;

  // Stats
  this._stats = {
    framesSent: 0,
    framesRecv: 0,
    bytesSent: 0,
    bytesRecv: 0,
    sendQueueOverflows: 0,
    reconnects: 0,
    errors: 0
  };

  // Events
  this._handlers = {};
}

// ---------------------------------------------------------------------------
// Server mode — listen for incoming peer
// ---------------------------------------------------------------------------

TcpStack.prototype.listen = function(port, callback) {
  var self = this;
  this._mode = 'server';
  this._port = port || this._port;

  this._server = net.createServer({ noDelay: true }, function(socket) {
    // Accept only one peer at a time
    if (self._connected) {
      socket.destroy();
      return;
    }
    self._acceptSocket(socket);
  });

  this._server.on('error', function(err) {
    self._stats.errors++;
    self._emit('error', err);
    if (callback) { callback(err); callback = null; }
  });

  this._server.listen(this._port, '0.0.0.0', function() {
    self._emit('listening', self._port);
    if (callback) { callback(null, self._port); callback = null; }
  });
};

// ---------------------------------------------------------------------------
// Client mode — connect to a peer
// ---------------------------------------------------------------------------

TcpStack.prototype.connect = function(host, port, callback) {
  var self = this;
  this._mode = 'client';
  this._reconnectTarget = { host: host, port: port || this._port };

  var socket = net.createConnection({
    host: host,
    port: port || this._port,
    noDelay: true
  });

  socket.on('connect', function() {
    self._reconnectAttempt = 0;
    self._acceptSocket(socket);
    if (callback) { callback(null); callback = null; }
  });

  socket.on('error', function(err) {
    self._stats.errors++;
    if (callback) { callback(err); callback = null; }
    else { self._emit('error', err); }
  });
};

// ---------------------------------------------------------------------------
// Socket lifecycle
// ---------------------------------------------------------------------------

TcpStack.prototype._acceptSocket = function(socket) {
  var self = this;

  this._socket = socket;
  this._connected = true;
  this._peerAddress = socket.remoteAddress;
  this._peerPort = socket.remotePort;
  this._lastRecvTime = Date.now();

  // TCP tuning for LAN
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 10000);

  // Set socket buffer sizes
  if (typeof socket.setRecvBufferSize === 'function') {
    try { socket.setRecvBufferSize(this.sendBufferSize); } catch(e) {}
  }
  if (typeof socket.setSendBufferSize === 'function') {
    try { socket.setSendBufferSize(this.sendBufferSize); } catch(e) {}
  }

  // Allocate receive buffer
  this._recvBuf = Buffer.alloc(this.sendBufferSize);
  this._recvBufLen = 0;
  this._recvBufAlloc = this.sendBufferSize;

  // Wire events
  socket.on('data', function(chunk) {
    self._onData(chunk);
  });

  socket.on('end', function() {
    self._onDisconnect('peer_closed');
  });

  socket.on('close', function() {
    self._onDisconnect('socket_closed');
  });

  socket.on('error', function(err) {
    self._stats.errors++;
    self._emit('error', err);
    self._onDisconnect('error');
  });

  // Handle backpressure
  socket.on('drain', function() {
    self._draining = false;
    self._flushSendQueue();
  });

  // Start keepalive
  this._startKeepalive();

  // Start bandwidth metering
  this._startBwMeter();

  this._emit('connect', {
    address: this._peerAddress,
    port: this._peerPort
  });
};

TcpStack.prototype._onDisconnect = function(reason) {
  if (!this._connected) return;
  this._connected = false;

  this._stopKeepalive();
  this._stopBwMeter();

  if (this._socket) {
    try { this._socket.destroy(); } catch(e) {}
    this._socket = null;
  }

  // Clear send queue
  this._sendQueue = [];
  this._sendQueueBytes = 0;
  this._recvBufLen = 0;

  this._emit('disconnect', reason);

  // Auto-reconnect (client mode only)
  if (this._mode === 'client' && this._reconnectEnabled && this._reconnectTarget) {
    this._scheduleReconnect();
  }
};

TcpStack.prototype._scheduleReconnect = function() {
  var self = this;
  if (this._reconnectTimer) return;
  if (this._reconnectAttempt >= C.RECONNECT_MAX_ATTEMPTS) {
    this._emit('reconnect_failed', this._reconnectAttempt);
    return;
  }

  // Exponential backoff with jitter
  var delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt),
    RECONNECT_MAX_MS
  );
  delay += Math.random() * RECONNECT_JITTER;
  this._reconnectAttempt++;

  this._reconnectTimer = setTimeout(function() {
    self._reconnectTimer = null;
    self._stats.reconnects++;
    self._emit('reconnecting', self._reconnectAttempt);
    self.connect(self._reconnectTarget.host, self._reconnectTarget.port);
  }, delay);
};

// ---------------------------------------------------------------------------
// Frame: write (send)
// ---------------------------------------------------------------------------

/**
 * Send a message on a given channel.
 *
 * @param {number} channel - CH.STATE, CH.DATA, CH.CONTROL, or CH.AUDIO
 * @param {Buffer} payload - The protocol.js-format packet (type + seq + data)
 * @returns {boolean} true if queued/sent, false if dropped (buffer full)
 */
TcpStack.prototype.send = function(channel, payload) {
  if (!this._connected) return false;

  // Build frame: [4 LE: length][1: channel][payload]
  var frameLen = FRAME_HEADER_LEN + payload.length;
  var frame = Buffer.alloc(frameLen);
  frame.writeUInt32LE(payload.length + 1, 0); // length includes channel byte
  frame[4] = channel;
  payload.copy(frame, FRAME_HEADER_LEN);

  // Backpressure check
  if (this._sendQueueBytes + frameLen > this.sendBufferSize) {
    // Buffer full — drop lowest priority (state) or reject
    if (channel === CH.STATE || channel === CH.AUDIO) {
      this._stats.sendQueueOverflows++;
      this._emit('backpressure', {
        queueBytes: this._sendQueueBytes,
        limit: this.sendBufferSize,
        dropped: true
      });
      return false;
    }
    // For DATA/CONTROL: queue anyway (critical messages)
  }

  this._sendQueue.push(frame);
  this._sendQueueBytes += frameLen;
  this._stats.framesSent++;
  this._stats.bytesSent += frameLen;
  this._bytesSent += frameLen;

  this._flushSendQueue();
  return true;
};

TcpStack.prototype._flushSendQueue = function() {
  if (this._draining || !this._socket || this._sendQueue.length === 0) return;

  // Coalesce multiple small frames into one write (reduces syscalls)
  var batch;
  if (this._sendQueue.length === 1) {
    batch = this._sendQueue[0];
  } else {
    batch = Buffer.concat(this._sendQueue);
  }

  var totalBytes = this._sendQueueBytes;
  this._sendQueue = [];
  this._sendQueueBytes = 0;

  var ok = this._socket.write(batch);
  if (!ok) {
    // Kernel buffer full — wait for 'drain'
    this._draining = true;
  }
};

// ---------------------------------------------------------------------------
// Convenience: send on specific channels
// ---------------------------------------------------------------------------

TcpStack.prototype.sendState = function(payload) {
  return this.send(CH.STATE, toBuffer(payload));
};

TcpStack.prototype.sendData = function(payload) {
  return this.send(CH.DATA, toBuffer(payload));
};

TcpStack.prototype.sendControl = function(payload) {
  return this.send(CH.CONTROL, toBuffer(payload));
};

TcpStack.prototype.sendAudio = function(payload) {
  return this.send(CH.AUDIO, toBuffer(payload));
};

// ---------------------------------------------------------------------------
// High-level: send typed messages
// ---------------------------------------------------------------------------

/**
 * Send a JSON-serializable object reliably on the DATA channel.
 * @param {number} pktType - C.PKT.* type byte
 * @param {object|Buffer} data - JSON object or raw Buffer
 * @returns {boolean}
 */
TcpStack.prototype.sendMessage = function(pktType, data) {
  var payload;
  if (Buffer.isBuffer(data)) {
    payload = data;
  } else {
    payload = Buffer.from(JSON.stringify(data), 'utf8');
  }

  // Build protocol-format packet: [1 type][4 seq][N data]
  var pkt = Buffer.alloc(5 + payload.length);
  pkt[0] = pktType;
  pkt.writeUInt32LE(this._txSeq++, 1);
  payload.copy(pkt, 5);

  return this.sendData(pkt);
};

/**
 * Send a manifest (JSON, reliable).
 */
TcpStack.prototype.sendManifest = function(manifest) {
  return this.sendMessage(C.PKT.ASSET_MANIFEST, manifest);
};

/**
 * Send a file transfer.
 * @param {string} relativePath
 * @param {Buffer} fileData
 */
TcpStack.prototype.sendFile = function(relativePath, fileData) {
  var pathBuf = Buffer.from(relativePath, 'utf8');
  var header = Buffer.alloc(2);
  header.writeUInt16LE(pathBuf.length, 0);
  var payload = Buffer.concat([header, pathBuf, fileData]);
  return this.sendMessage(C.PKT.ASSET_TRANSFER, payload);
};

/**
 * Send a cursor update (high-frequency, STATE channel).
 */
TcpStack.prototype.sendCursor = function(packet) {
  return this.sendState(toBuffer(packet));
};

// ---------------------------------------------------------------------------
// Frame: read (receive)
// ---------------------------------------------------------------------------

TcpStack.prototype._onData = function(chunk) {
  this._lastRecvTime = Date.now();
  this._stats.bytesRecv += chunk.length;
  this._bytesRecv += chunk.length;

  // Append to receive buffer
  this._ensureRecvSpace(chunk.length);
  chunk.copy(this._recvBuf, this._recvBufLen);
  this._recvBufLen += chunk.length;

  // Parse complete frames
  this._parseFrames();
};

TcpStack.prototype._ensureRecvSpace = function(needed) {
  var required = this._recvBufLen + needed;
  if (required <= this._recvBufAlloc) return;

  // Grow buffer (double until it fits)
  var newSize = this._recvBufAlloc;
  while (newSize < required) newSize *= 2;
  if (newSize > MAX_FRAME_SIZE * 2) {
    // Pathological — reset
    this._recvBufLen = 0;
    this._stats.errors++;
    return;
  }

  var newBuf = Buffer.alloc(newSize);
  if (this._recvBufLen > 0) {
    this._recvBuf.copy(newBuf, 0, 0, this._recvBufLen);
  }
  this._recvBuf = newBuf;
  this._recvBufAlloc = newSize;
};

TcpStack.prototype._parseFrames = function() {
  var offset = 0;

  while (offset + FRAME_HEADER_LEN <= this._recvBufLen) {
    // Read frame length (includes channel byte)
    var framePayloadLen = this._recvBuf.readUInt32LE(offset);

    // Sanity check
    if (framePayloadLen > MAX_FRAME_SIZE || framePayloadLen < 1) {
      // Corrupt stream — reset buffer
      this._recvBufLen = 0;
      this._stats.errors++;
      this._emit('error', new Error('corrupt frame: length=' + framePayloadLen));
      return;
    }

    // Do we have the full frame?
    var totalFrameLen = 4 + framePayloadLen; // 4-byte length prefix + payload
    if (offset + totalFrameLen > this._recvBufLen) {
      break; // incomplete frame — wait for more data
    }

    // Extract channel and payload
    var channel = this._recvBuf[offset + 4];
    var payload = Buffer.alloc(framePayloadLen - 1);
    this._recvBuf.copy(payload, 0, offset + FRAME_HEADER_LEN, offset + totalFrameLen);

    this._stats.framesRecv++;
    offset += totalFrameLen;

    // Dispatch
    this._dispatchFrame(channel, payload);
  }

  // Compact receive buffer
  if (offset > 0) {
    if (offset < this._recvBufLen) {
      this._recvBuf.copy(this._recvBuf, 0, offset, this._recvBufLen);
    }
    this._recvBufLen -= offset;
  }
};

TcpStack.prototype._dispatchFrame = function(channel, payload) {
  if (payload.length < 1) return;

  var pktType = payload[0];

  // Control channel — internal keepalive/ping handling
  if (channel === CH.CONTROL) {
    if (pktType === C.PKT.PING) {
      this._handlePing(payload);
      return;
    }
    if (pktType === C.PKT.PONG) {
      this._handlePong(payload);
      return;
    }
    if (pktType === C.PKT.HEARTBEAT) {
      this._emit('heartbeat', payload);
      // Auto-reply
      var ack = Buffer.alloc(5);
      ack[0] = C.PKT.HEARTBEAT_ACK;
      if (payload.length >= 5) payload.copy(ack, 1, 1, 5);
      this.sendControl(ack);
      return;
    }
    if (pktType === C.PKT.HEARTBEAT_ACK) {
      this._emit('heartbeat_ack', payload);
      return;
    }
    if (pktType === C.PKT.CONNECT_REQUEST) {
      this._emit('connect_request', payload);
      return;
    }
    if (pktType === C.PKT.CONNECT_ACCEPT) {
      this._emit('connect_accept', payload);
      return;
    }
    if (pktType === C.PKT.DISCONNECT) {
      this._emit('disconnect_msg', payload);
      this._onDisconnect('peer_disconnect');
      return;
    }
  }

  // State channel
  if (channel === CH.STATE) {
    switch (pktType) {
      case C.PKT.STATE_UPDATE:
      case C.PKT.STATE_SYNC:
        this._emit('state', payload);
        break;
      case C.PKT.CURSOR_UPDATE:
        this._emit('cursor', payload);
        break;
      default:
        this._emit('state_raw', payload);
    }
    return;
  }

  // Data channel
  if (channel === CH.DATA) {
    switch (pktType) {
      case C.PKT.ASSET_MANIFEST:
        this._emit('asset_manifest', payload.slice(5));
        break;
      case C.PKT.ASSET_REQUEST:
        this._emit('asset_request', payload.slice(5));
        break;
      case C.PKT.ASSET_TRANSFER:
        this._emit('asset_transfer', payload.slice(5));
        break;
      case C.PKT.ASSET_MISSING:
        this._emit('asset_missing', payload.slice(5));
        break;
      case C.PKT.PLUGIN_AUDIT:
        this._emit('plugin_audit', payload.slice(5));
        break;
      default:
        this._emit('data_raw', payload);
    }
    return;
  }

  // Audio channel
  if (channel === CH.AUDIO) {
    this._emit('audio', payload);
    return;
  }

  // Unknown channel
  this._emit('unknown', { channel: channel, payload: payload });
};

// ---------------------------------------------------------------------------
// Keepalive (application-level, supplements TCP keepalive)
// ---------------------------------------------------------------------------

TcpStack.prototype._startKeepalive = function() {
  var self = this;

  this._keepaliveTimer = setInterval(function() {
    if (!self._connected) return;
    self.sendPing();
  }, KEEPALIVE_INTERVAL_MS);

  this._keepaliveCheckTimer = setInterval(function() {
    if (!self._connected) return;
    var elapsed = Date.now() - self._lastRecvTime;
    if (elapsed > KEEPALIVE_TIMEOUT_MS) {
      self._emit('timeout', elapsed);
      self._onDisconnect('keepalive_timeout');
    }
  }, 1000);
};

TcpStack.prototype._stopKeepalive = function() {
  if (this._keepaliveTimer) { clearInterval(this._keepaliveTimer); this._keepaliveTimer = null; }
  if (this._keepaliveCheckTimer) { clearInterval(this._keepaliveCheckTimer); this._keepaliveCheckTimer = null; }
};

// ---------------------------------------------------------------------------
// Ping / Pong (RTT measurement over TCP)
// ---------------------------------------------------------------------------

TcpStack.prototype.sendPing = function() {
  if (!this._connected) return;
  var buf = Buffer.alloc(13); // type(1) + seq(4) + timestamp(8)
  buf[0] = C.PKT.PING;
  buf.writeUInt32LE(this._txSeq++, 1);
  var now = Date.now();
  buf.writeUInt32LE(now >>> 0, 5);
  buf.writeUInt32LE((now / 0x100000000) >>> 0, 9);
  this._pingSentAt = now;
  this._pingPending = true;
  this.sendControl(buf);
};

TcpStack.prototype._handlePing = function(payload) {
  // Echo the timestamp back as PONG
  var buf = Buffer.alloc(13);
  buf[0] = C.PKT.PONG;
  buf.writeUInt32LE(this._txSeq++, 1);
  if (payload.length >= 13) {
    payload.copy(buf, 5, 5, 13);
  }
  this.sendControl(buf);
};

TcpStack.prototype._handlePong = function(payload) {
  if (payload.length < 13) return;
  var lo = payload.readUInt32LE(5);
  var hi = payload.readUInt32LE(9);
  var sentAt = hi * 0x100000000 + lo;
  var now = Date.now();
  var sample = now - sentAt;
  if (sample >= 0 && sample < 10000) {
    // EWMA smoothing
    if (this.rttMs === 0) {
      this.rttMs = sample;
    } else {
      this.rttMs = this.rttMs * 0.875 + sample * 0.125;
    }
    this._pingPending = false;
    this._emit('rtt', Math.round(this.rttMs * 100) / 100);
  }
};

// ---------------------------------------------------------------------------
// Bandwidth metering
// ---------------------------------------------------------------------------

TcpStack.prototype._startBwMeter = function() {
  var self = this;
  this._bwStart = Date.now();
  this._bytesSent = 0;
  this._bytesRecv = 0;
  this._bwTimer = setInterval(function() {
    var now = Date.now();
    var elapsed = now - self._bwStart;
    if (elapsed >= 1000) {
      self.sendBps = Math.round((self._bytesSent * 1000) / elapsed);
      self.recvBps = Math.round((self._bytesRecv * 1000) / elapsed);
      self._bytesSent = 0;
      self._bytesRecv = 0;
      self._bwStart = now;
      self._emit('bandwidth', { send: self.sendBps, recv: self.recvBps });
    }
  }, 1000);
};

TcpStack.prototype._stopBwMeter = function() {
  if (this._bwTimer) { clearInterval(this._bwTimer); this._bwTimer = null; }
};

// ---------------------------------------------------------------------------
// Send buffer control — the adjustable knob
// ---------------------------------------------------------------------------

/**
 * Set the application-level send buffer size (bytes).
 * Larger = can queue more during bursts (file transfers on slower networks).
 * Smaller = tighter backpressure, lower memory, faster drop detection.
 *
 * @param {number} bytes - Buffer size (clamped to 16KB–16MB)
 */
TcpStack.prototype.setSendBuffer = function(bytes) {
  this.sendBufferSize = clamp(bytes, MIN_SEND_BUFFER, MAX_SEND_BUFFER);
};

/**
 * Convenience: set buffer by network quality preset.
 * @param {'gigabit'|'fast'|'wifi'|'slow'} quality
 */
TcpStack.prototype.setNetworkQuality = function(quality) {
  switch (quality) {
    case 'gigabit':
      this.sendBufferSize = 64 * 1024;       // 64KB — tiny, LAN is fast
      break;
    case 'fast':
      this.sendBufferSize = 256 * 1024;      // 256KB — default
      break;
    case 'wifi':
      this.sendBufferSize = 1024 * 1024;     // 1MB — wifi bursts need room
      break;
    case 'slow':
      this.sendBufferSize = 4 * 1024 * 1024; // 4MB — congested/VPN
      break;
    default:
      this.sendBufferSize = DEFAULT_SEND_BUFFER;
  }
};

// ---------------------------------------------------------------------------
// Graceful disconnect
// ---------------------------------------------------------------------------

TcpStack.prototype.disconnect = function() {
  if (this._connected && this._socket) {
    // Send disconnect message first
    var pkt = Buffer.alloc(5);
    pkt[0] = C.PKT.DISCONNECT;
    pkt.writeUInt32LE(this._txSeq++, 1);
    this.sendControl(pkt);

    // Allow the write to flush before closing
    var self = this;
    setTimeout(function() {
      self._reconnectEnabled = false; // don't reconnect after intentional close
      if (self._socket) {
        self._socket.end();
      }
    }, 50);
  } else {
    this._reconnectEnabled = false;
    this._onDisconnect('local_close');
  }
};

// ---------------------------------------------------------------------------
// Full teardown
// ---------------------------------------------------------------------------

TcpStack.prototype.destroy = function() {
  this._reconnectEnabled = false;
  if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
  this._stopKeepalive();
  this._stopBwMeter();

  if (this._socket) {
    try { this._socket.destroy(); } catch(e) {}
    this._socket = null;
  }
  if (this._server) {
    try { this._server.close(); } catch(e) {}
    this._server = null;
  }

  this._connected = false;
  this._sendQueue = [];
  this._sendQueueBytes = 0;
  this._recvBuf = null;
  this._recvBufLen = 0;
};

// ---------------------------------------------------------------------------
// Stats / diagnostics
// ---------------------------------------------------------------------------

TcpStack.prototype.getStats = function() {
  return {
    mode: this._mode,
    connected: this._connected,
    peerAddress: this._peerAddress,
    peerPort: this._peerPort,
    port: this._port,
    sendBufferSize: this.sendBufferSize,
    sendQueueBytes: this._sendQueueBytes,
    sendQueueFrames: this._sendQueue.length,
    draining: this._draining,
    rttMs: Math.round(this.rttMs * 100) / 100,
    sendBps: this.sendBps,
    recvBps: this.recvBps,
    reconnectAttempt: this._reconnectAttempt,
    counters: this._stats
  };
};

TcpStack.prototype.isConnected = function() {
  return this._connected;
};

TcpStack.prototype.getPeerAddress = function() {
  return this._peerAddress;
};

// ---------------------------------------------------------------------------
// Event system
// ---------------------------------------------------------------------------

TcpStack.prototype.on = function(event, handler) {
  if (!this._handlers[event]) this._handlers[event] = [];
  this._handlers[event].push(handler);
};

TcpStack.prototype.off = function(event, handler) {
  if (!this._handlers[event]) return;
  var idx = this._handlers[event].indexOf(handler);
  if (idx !== -1) this._handlers[event].splice(idx, 1);
};

TcpStack.prototype._emit = function(event, data) {
  var handlers = this._handlers[event];
  if (!handlers) return;
  for (var i = 0; i < handlers.length; i++) {
    try { handlers[i](data); } catch(e) {}
  }
};

// ---------------------------------------------------------------------------
// Expose channel constants
// ---------------------------------------------------------------------------

TcpStack.CH = CH;

// ---------------------------------------------------------------------------
// Static: parse file transfer payload (same format as lan-transport)
// ---------------------------------------------------------------------------

TcpStack.parseFileTransfer = function(payload) {
  var pathLen = payload.readUInt16LE(0);
  var path = payload.slice(2, 2 + pathLen).toString('utf8');
  var data = payload.slice(2 + pathLen);
  return { path: path, data: data };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = TcpStack;
}

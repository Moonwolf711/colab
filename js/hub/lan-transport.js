/**
 * coLaB LAN Transport — Real-time network module for peer-to-peer session data
 *
 * Handles all data transfer between coLaB peers on a local network:
 *   - State updates (CRDT diffs, cursor moves)   → fire-and-forget UDP
 *   - Reliable messages (manifests, file chunks)  → UDP with ACK + retransmit
 *   - File transfers (samples, presets)           → chunked reliable stream
 *   - Heartbeat / latency measurement             → round-trip timing
 *
 * Adaptive send buffer adjusts to measured network conditions in real time.
 *
 * Copyright (c) 2026 Tyler Yianacopolus / Moonwolf. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL — coLaB project original IP.
 *
 * @module lan-transport
 * @version 1.0.0
 * @license PROPRIETARY
 */

var dgram = require('dgram');
var C = require('../shared/constants');
var protocol = require('../shared/protocol');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var HEADER_SIZE = 5;                        // protocol.js header: 1 type + 4 seq
var RELIABLE_HEADER_SIZE = HEADER_SIZE + 6; // + 2 msgId + 2 chunkIdx + 2 totalChunks
var ACK_TYPE = 0xA0;
var NACK_TYPE = 0xA1;
var RELIABLE_WRAP_TYPE = 0xA2;
var PING_TYPE = 0xA3;
var PONG_TYPE = 0xA4;
var FLOW_CTRL_TYPE = 0xA5;

var DEFAULT_BUFFER_MS = 20;                 // default jitter buffer depth
var MIN_BUFFER_MS = 5;
var MAX_BUFFER_MS = 200;

var CHUNK_PAYLOAD = C.TRANSFER_CHUNK_SIZE;  // 32 KB per chunk
var MAX_INFLIGHT = 16;                      // concurrent unacked chunks
var ACK_TIMEOUT_MS = 150;                   // retransmit if no ACK within this
var MAX_RETRIES = 12;
var RTT_ALPHA = 0.125;                      // EWMA smoothing for RTT
var RTT_BETA = 0.25;                        // EWMA smoothing for RTT variance

// ---------------------------------------------------------------------------
// LanTransport
// ---------------------------------------------------------------------------

function LanTransport(options) {
  options = options || {};

  // --- configurable buffer (ms) — the user-facing "network speed" knob ---
  this.bufferMs = options.bufferMs || DEFAULT_BUFFER_MS;

  // Sockets
  this._stateSocket = null;   // unreliable channel (state, cursors, heartbeat)
  this._dataSocket = null;    // reliable channel (manifests, file chunks)

  // Addressing
  this._localPort = options.localPort || C.STATE_PORT;
  this._dataPort = options.dataPort || (C.STATE_PORT + 10);  // 4253
  this._peerIp = null;
  this._peerStatePort = C.STATE_PORT;
  this._peerDataPort = this._dataPort;
  this._bound = false;

  // Sequencing
  this._txSeq = 0;
  this._rxSeq = 0;            // highest contiguous received seq (for gap detect)

  // RTT estimation (Jacobson/Karels)
  this.rttMs = 10;             // smoothed RTT
  this._rttVar = 5;            // RTT variance
  this._rto = ACK_TIMEOUT_MS;  // retransmit timeout (dynamically adjusted)

  // Bandwidth estimation
  this.sendRateBps = 0;        // measured outbound bytes/sec
  this._bytesSentWindow = 0;
  this._bwWindowStart = 0;
  this.recvRateBps = 0;
  this._bytesRecvWindow = 0;

  // Jitter buffer for ordered delivery of unreliable packets
  this._jitterBuf = [];
  this._jitterTimer = null;
  this._jitterNextSeq = 0;

  // Reliable message tracking
  this._reliableMsgId = 0;
  this._inflightChunks = {};   // msgId-chunkIdx → { data, sentAt, retries }
  this._inflightCount = 0;
  this._retransmitTimer = null;

  // Receive-side reassembly
  this._reassembly = {};       // msgId → { totalChunks, received: {idx: data}, doneCount }

  // Send queue for reliable data (respects MAX_INFLIGHT window)
  this._sendQueue = [];

  // Flow control — peer tells us to slow down
  this._peerWindowSize = MAX_INFLIGHT;

  // Stats
  this._stats = {
    packetsSent: 0,
    packetsRecv: 0,
    bytesSent: 0,
    bytesRecv: 0,
    retransmits: 0,
    acksRecv: 0,
    nacksRecv: 0,
    chunksQueued: 0,
    chunksDelivered: 0,
    drops: 0
  };

  // Event handlers
  this._handlers = {};
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

LanTransport.prototype.bind = function(peerIp, callback) {
  var self = this;
  this._peerIp = peerIp;

  // State socket — unreliable fast path
  this._stateSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  this._stateSocket.on('message', function(msg, rinfo) {
    self._onStatePacket(msg, rinfo);
  });
  this._stateSocket.on('error', function(err) {
    self._emit('error', err);
  });

  // Data socket — reliable delivery
  this._dataSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  this._dataSocket.on('message', function(msg, rinfo) {
    self._onDataPacket(msg, rinfo);
  });
  this._dataSocket.on('error', function(err) {
    self._emit('error', err);
  });

  // Bind both
  var boundCount = 0;
  function onBound() {
    boundCount++;
    if (boundCount === 2) {
      self._bound = true;
      self._bwWindowStart = Date.now();
      self._startJitterDrain();
      self._startRetransmitCheck();
      if (callback) callback(null);
    }
  }

  this._stateSocket.bind(this._localPort, onBound);
  this._dataSocket.bind(this._dataPort, onBound);
};

LanTransport.prototype.destroy = function() {
  this._bound = false;
  if (this._jitterTimer) { clearInterval(this._jitterTimer); this._jitterTimer = null; }
  if (this._retransmitTimer) { clearInterval(this._retransmitTimer); this._retransmitTimer = null; }
  if (this._stateSocket) { try { this._stateSocket.close(); } catch(e){} this._stateSocket = null; }
  if (this._dataSocket) { try { this._dataSocket.close(); } catch(e){} this._dataSocket = null; }
  this._inflightChunks = {};
  this._inflightCount = 0;
  this._reassembly = {};
  this._sendQueue = [];
  this._jitterBuf = [];
};

// ---------------------------------------------------------------------------
// Buffer control — the adjustable knob
// ---------------------------------------------------------------------------

/**
 * Set the jitter buffer depth in milliseconds.
 * Lower = less latency but more drops on bad networks.
 * Higher = smoother on congested/wifi LANs but adds delay.
 *
 * @param {number} ms - Buffer depth (clamped to 5–200ms)
 */
LanTransport.prototype.setBuffer = function(ms) {
  this.bufferMs = Math.max(MIN_BUFFER_MS, Math.min(MAX_BUFFER_MS, ms));
};

/**
 * Auto-tune buffer based on measured jitter.
 * Called internally when RTT variance spikes.
 */
LanTransport.prototype._autoTuneBuffer = function() {
  // Target: 2x RTT variance, clamped
  var target = Math.round(this._rttVar * 4);
  // Only auto-tune upward (don't reduce below user setting if manual)
  if (target > this.bufferMs) {
    this.bufferMs = Math.min(MAX_BUFFER_MS, target);
    this._emit('buffer_adjusted', this.bufferMs);
  }
};

// ---------------------------------------------------------------------------
// Unreliable send (state updates, cursors, heartbeats)
// ---------------------------------------------------------------------------

LanTransport.prototype.sendUnreliable = function(packet) {
  if (!this._bound || !this._peerIp) return;
  this._udpSend(this._stateSocket, packet, this._peerIp, this._peerStatePort);
};

// Convenience: send a pre-built protocol packet
LanTransport.prototype.sendState = function(packet) { this.sendUnreliable(packet); };
LanTransport.prototype.sendCursor = function(packet) { this.sendUnreliable(packet); };

// ---------------------------------------------------------------------------
// Ping / Pong (latency measurement)
// ---------------------------------------------------------------------------

LanTransport.prototype.sendPing = function() {
  if (!this._bound) return;
  var buf = Buffer.alloc(HEADER_SIZE + 8);
  buf[0] = PING_TYPE;
  buf.writeUInt32LE(this._txSeq++, 1);
  // Embed high-res timestamp
  var now = process.hrtime.bigint ? Number(process.hrtime.bigint() / 1000000n) : Date.now();
  buf.writeUInt32LE((now >>> 0), HEADER_SIZE);
  buf.writeUInt32LE(((now / 0x100000000) >>> 0), HEADER_SIZE + 4);
  this._udpSend(this._stateSocket, buf, this._peerIp, this._peerStatePort);
};

LanTransport.prototype._handlePing = function(msg) {
  // Echo the timestamp back
  var buf = Buffer.alloc(HEADER_SIZE + 8);
  buf[0] = PONG_TYPE;
  buf.writeUInt32LE(this._txSeq++, 1);
  msg.copy(buf, HEADER_SIZE, HEADER_SIZE, HEADER_SIZE + 8);
  this._udpSend(this._stateSocket, buf, this._peerIp, this._peerStatePort);
};

LanTransport.prototype._handlePong = function(msg) {
  var lo = msg.readUInt32LE(HEADER_SIZE);
  var hi = msg.readUInt32LE(HEADER_SIZE + 4);
  var sentAt = hi * 0x100000000 + lo;
  var now = process.hrtime.bigint ? Number(process.hrtime.bigint() / 1000000n) : Date.now();
  var sample = now - sentAt;
  if (sample < 0 || sample > 5000) return; // bogus

  // Jacobson/Karels RTT estimation
  var err = sample - this.rttMs;
  this.rttMs = this.rttMs + RTT_ALPHA * err;
  this._rttVar = this._rttVar + RTT_BETA * (Math.abs(err) - this._rttVar);
  this._rto = Math.max(50, Math.min(2000, this.rttMs + 4 * this._rttVar));

  this._autoTuneBuffer();
  this._emit('rtt', this.rttMs);
};

// ---------------------------------------------------------------------------
// Reliable send (manifests, file transfers, plugin audits)
// ---------------------------------------------------------------------------

/**
 * Send a payload reliably (with ACK, retransmit, chunking).
 * @param {number} pktType - Packet type byte from C.PKT.*
 * @param {Buffer} payload - Full payload to deliver
 * @param {function} [callback] - Called with (err) when fully ACKed or failed
 */
LanTransport.prototype.sendReliable = function(pktType, payload, callback) {
  var msgId = this._reliableMsgId++;
  var totalChunks = Math.ceil(payload.length / CHUNK_PAYLOAD) || 1;

  for (var i = 0; i < totalChunks; i++) {
    var offset = i * CHUNK_PAYLOAD;
    var end = Math.min(offset + CHUNK_PAYLOAD, payload.length);
    var chunkData = payload.slice(offset, end);

    // Build reliable wrapper:
    // [1: RELIABLE_WRAP_TYPE] [4: seq] [1: innerType] [2: msgId] [2: chunkIdx] [2: totalChunks] [N: data]
    var hdrLen = 1 + 4 + 1 + 2 + 2 + 2;
    var buf = Buffer.alloc(hdrLen + chunkData.length);
    buf[0] = RELIABLE_WRAP_TYPE;
    buf.writeUInt32LE(this._txSeq++, 1);
    buf[5] = pktType;
    buf.writeUInt16LE(msgId, 6);
    buf.writeUInt16LE(i, 8);
    buf.writeUInt16LE(totalChunks, 10);
    chunkData.copy(buf, hdrLen);

    this._sendQueue.push({
      msgId: msgId,
      chunkIdx: i,
      totalChunks: totalChunks,
      buf: buf,
      callback: (i === totalChunks - 1) ? callback : null
    });
  }

  this._stats.chunksQueued += totalChunks;
  this._drainSendQueue();
};

/**
 * Push queued chunks into the inflight window up to MAX_INFLIGHT.
 */
LanTransport.prototype._drainSendQueue = function() {
  var windowSize = Math.min(MAX_INFLIGHT, this._peerWindowSize);

  while (this._sendQueue.length > 0 && this._inflightCount < windowSize) {
    var item = this._sendQueue.shift();
    var key = item.msgId + '-' + item.chunkIdx;

    this._inflightChunks[key] = {
      buf: item.buf,
      sentAt: Date.now(),
      retries: 0,
      callback: item.callback,
      msgId: item.msgId,
      chunkIdx: item.chunkIdx,
      totalChunks: item.totalChunks
    };
    this._inflightCount++;

    this._udpSend(this._dataSocket, item.buf, this._peerIp, this._peerDataPort);
  }
};

// ---------------------------------------------------------------------------
// ACK / NACK handling
// ---------------------------------------------------------------------------

LanTransport.prototype._sendAck = function(msgId, chunkIdx) {
  var buf = Buffer.alloc(1 + 2 + 2);
  buf[0] = ACK_TYPE;
  buf.writeUInt16LE(msgId, 1);
  buf.writeUInt16LE(chunkIdx, 3);
  this._udpSend(this._dataSocket, buf, this._peerIp, this._peerDataPort);
};

LanTransport.prototype._sendNack = function(msgId, chunkIdx) {
  var buf = Buffer.alloc(1 + 2 + 2);
  buf[0] = NACK_TYPE;
  buf.writeUInt16LE(msgId, 1);
  buf.writeUInt16LE(chunkIdx, 3);
  this._udpSend(this._dataSocket, buf, this._peerIp, this._peerDataPort);
};

LanTransport.prototype._sendFlowControl = function(windowSize) {
  var buf = Buffer.alloc(1 + 2);
  buf[0] = FLOW_CTRL_TYPE;
  buf.writeUInt16LE(windowSize, 1);
  this._udpSend(this._dataSocket, buf, this._peerIp, this._peerDataPort);
};

LanTransport.prototype._handleAck = function(msg) {
  var msgId = msg.readUInt16LE(1);
  var chunkIdx = msg.readUInt16LE(3);
  var key = msgId + '-' + chunkIdx;

  var entry = this._inflightChunks[key];
  if (!entry) return;

  // Update RTT from ACK round-trip
  var elapsed = Date.now() - entry.sentAt;
  if (entry.retries === 0) { // only use first-attempt samples
    var err = elapsed - this.rttMs;
    this.rttMs = this.rttMs + RTT_ALPHA * err;
    this._rttVar = this._rttVar + RTT_BETA * (Math.abs(err) - this._rttVar);
    this._rto = Math.max(50, Math.min(2000, this.rttMs + 4 * this._rttVar));
  }

  // Check if this completes the message
  var cb = entry.callback;

  delete this._inflightChunks[key];
  this._inflightCount--;
  this._stats.acksRecv++;
  this._stats.chunksDelivered++;

  if (cb) cb(null);

  // Push more from queue
  this._drainSendQueue();
};

LanTransport.prototype._handleNack = function(msg) {
  var msgId = msg.readUInt16LE(1);
  var chunkIdx = msg.readUInt16LE(3);
  var key = msgId + '-' + chunkIdx;
  this._stats.nacksRecv++;

  var entry = this._inflightChunks[key];
  if (!entry) return;

  // Immediate retransmit on NACK
  entry.retries++;
  entry.sentAt = Date.now();
  this._stats.retransmits++;
  this._udpSend(this._dataSocket, entry.buf, this._peerIp, this._peerDataPort);
};

LanTransport.prototype._handleFlowControl = function(msg) {
  this._peerWindowSize = msg.readUInt16LE(1);
  this._drainSendQueue();
};

// ---------------------------------------------------------------------------
// Retransmit timer — checks inflight chunks for timeout
// ---------------------------------------------------------------------------

LanTransport.prototype._startRetransmitCheck = function() {
  var self = this;
  this._retransmitTimer = setInterval(function() {
    var now = Date.now();
    var keys = Object.keys(self._inflightChunks);
    for (var i = 0; i < keys.length; i++) {
      var entry = self._inflightChunks[keys[i]];
      if (now - entry.sentAt > self._rto) {
        if (entry.retries >= MAX_RETRIES) {
          // Give up on this chunk
          var cb = entry.callback;
          delete self._inflightChunks[keys[i]];
          self._inflightCount--;
          self._stats.drops++;
          if (cb) cb(new Error('chunk delivery failed after ' + MAX_RETRIES + ' retries'));
          self._drainSendQueue();
        } else {
          // Retransmit
          entry.retries++;
          entry.sentAt = now;
          self._stats.retransmits++;
          self._udpSend(self._dataSocket, entry.buf, self._peerIp, self._peerDataPort);
        }
      }
    }
  }, 50); // check every 50ms
};

// ---------------------------------------------------------------------------
// Receive: unreliable state packets
// ---------------------------------------------------------------------------

LanTransport.prototype._onStatePacket = function(msg, rinfo) {
  if (msg.length < 1) return;
  this._stats.packetsRecv++;
  this._stats.bytesRecv += msg.length;
  this._updateRecvBw(msg.length);

  var type = msg[0];

  if (type === PING_TYPE) {
    this._handlePing(msg);
    return;
  }
  if (type === PONG_TYPE) {
    this._handlePong(msg);
    return;
  }

  // If buffer is 0 or very low, deliver immediately
  if (this.bufferMs <= MIN_BUFFER_MS) {
    this._deliverStatePacket(msg);
    return;
  }

  // Insert into jitter buffer
  var seq = msg.length >= 5 ? msg.readUInt32LE(1) : 0;
  this._jitterBuf.push({ seq: seq, msg: msg, arriveAt: Date.now() });

  // Sort by sequence (simple insertion — buffer is small)
  this._jitterBuf.sort(function(a, b) { return a.seq - b.seq; });
};

LanTransport.prototype._startJitterDrain = function() {
  var self = this;
  // Drain jitter buffer at 1ms resolution
  this._jitterTimer = setInterval(function() {
    var now = Date.now();
    var cutoff = now - self.bufferMs;

    while (self._jitterBuf.length > 0 && self._jitterBuf[0].arriveAt <= cutoff) {
      var entry = self._jitterBuf.shift();
      self._deliverStatePacket(entry.msg);
    }

    // Discard packets that are way too old (> 3x buffer)
    var stale = now - self.bufferMs * 3;
    while (self._jitterBuf.length > 0 && self._jitterBuf[0].arriveAt < stale) {
      self._jitterBuf.shift();
      self._stats.drops++;
    }
  }, 1);
};

LanTransport.prototype._deliverStatePacket = function(msg) {
  if (msg.length < 1) return;
  var type = msg[0];

  switch (type) {
    case C.PKT.STATE_UPDATE:
    case C.PKT.STATE_SYNC:
      this._emit('state', msg);
      break;
    case C.PKT.CURSOR_UPDATE:
      this._emit('cursor', msg);
      break;
    case C.PKT.HEARTBEAT:
      this._emit('heartbeat', msg);
      // Auto-reply with ACK
      var ack = Buffer.alloc(HEADER_SIZE);
      ack[0] = C.PKT.HEARTBEAT_ACK;
      ack.writeUInt32LE(msg.readUInt32LE(1), 1);
      this._udpSend(this._stateSocket, ack, this._peerIp, this._peerStatePort);
      break;
    case C.PKT.HEARTBEAT_ACK:
      this._emit('heartbeat_ack', msg);
      break;
    case C.PKT.CONNECT_REQUEST:
      this._emit('connect_request', msg);
      break;
    case C.PKT.CONNECT_ACCEPT:
      this._emit('connect_accept', msg);
      break;
    case C.PKT.DISCONNECT:
      this._emit('disconnect', msg);
      break;
    case C.PKT.DISCOVERY_BEACON:
    case C.PKT.DISCOVERY_RESPONSE:
      this._emit('discovery', msg);
      break;
    default:
      this._emit('unknown', msg);
  }
};

// ---------------------------------------------------------------------------
// Receive: reliable data packets
// ---------------------------------------------------------------------------

LanTransport.prototype._onDataPacket = function(msg, rinfo) {
  if (msg.length < 1) return;
  this._stats.packetsRecv++;
  this._stats.bytesRecv += msg.length;
  this._updateRecvBw(msg.length);

  var type = msg[0];

  if (type === ACK_TYPE) { this._handleAck(msg); return; }
  if (type === NACK_TYPE) { this._handleNack(msg); return; }
  if (type === FLOW_CTRL_TYPE) { this._handleFlowControl(msg); return; }

  if (type !== RELIABLE_WRAP_TYPE) return;
  if (msg.length < 12) return; // too short for reliable header

  // Parse reliable header
  var innerType = msg[5];
  var msgId = msg.readUInt16LE(6);
  var chunkIdx = msg.readUInt16LE(8);
  var totalChunks = msg.readUInt16LE(10);
  var payload = msg.slice(12);

  // ACK this chunk
  this._sendAck(msgId, chunkIdx);

  // Reassemble
  if (!this._reassembly[msgId]) {
    this._reassembly[msgId] = {
      innerType: innerType,
      totalChunks: totalChunks,
      received: {},
      doneCount: 0,
      createdAt: Date.now()
    };
  }

  var rm = this._reassembly[msgId];
  if (rm.received[chunkIdx]) return; // duplicate

  rm.received[chunkIdx] = payload;
  rm.doneCount++;

  // Check if all chunks arrived
  if (rm.doneCount === rm.totalChunks) {
    // Concatenate in order
    var parts = [];
    var totalLen = 0;
    for (var i = 0; i < rm.totalChunks; i++) {
      if (!rm.received[i]) {
        // Should not happen — doneCount matched, but guard anyway
        return;
      }
      parts.push(rm.received[i]);
      totalLen += rm.received[i].length;
    }

    var fullPayload = Buffer.concat(parts, totalLen);
    delete this._reassembly[msgId];

    // Deliver the reassembled message
    this._deliverReliableMessage(rm.innerType, fullPayload);
  } else {
    // Check for missing chunks after a delay (request via NACK)
    this._scheduleGapCheck(msgId);
  }

  // Periodically clean stale reassembly entries
  this._cleanReassembly();
};

LanTransport.prototype._scheduleGapCheck = function(msgId) {
  var self = this;
  // Wait 2x RTO then NACK any missing chunks
  setTimeout(function() {
    var rm = self._reassembly[msgId];
    if (!rm) return; // already completed

    for (var i = 0; i < rm.totalChunks; i++) {
      if (!rm.received[i]) {
        self._sendNack(msgId, i);
      }
    }
  }, this._rto * 2);
};

LanTransport.prototype._cleanReassembly = function() {
  var now = Date.now();
  var timeout = 30000; // 30s stale timeout
  var keys = Object.keys(this._reassembly);
  for (var i = 0; i < keys.length; i++) {
    if (now - this._reassembly[keys[i]].createdAt > timeout) {
      delete this._reassembly[keys[i]];
    }
  }
};

LanTransport.prototype._deliverReliableMessage = function(innerType, payload) {
  switch (innerType) {
    case C.PKT.ASSET_MANIFEST:
      this._emit('asset_manifest', payload);
      break;
    case C.PKT.ASSET_REQUEST:
      this._emit('asset_request', payload);
      break;
    case C.PKT.ASSET_TRANSFER:
      this._emit('asset_transfer', payload);
      break;
    case C.PKT.ASSET_MISSING:
      this._emit('asset_missing', payload);
      break;
    case C.PKT.PLUGIN_AUDIT:
      this._emit('plugin_audit', payload);
      break;
    default:
      this._emit('reliable_message', { type: innerType, payload: payload });
  }
};

// ---------------------------------------------------------------------------
// High-level: send asset manifest (reliable, auto-serialized)
// ---------------------------------------------------------------------------

LanTransport.prototype.sendManifest = function(manifest, callback) {
  var json = Buffer.from(JSON.stringify(manifest), 'utf8');
  this.sendReliable(C.PKT.ASSET_MANIFEST, json, callback);
};

// ---------------------------------------------------------------------------
// High-level: file transfer (chunked reliable stream)
// ---------------------------------------------------------------------------

/**
 * Send a file to the peer.
 * @param {string} relativePath - Path relative to project root
 * @param {Buffer} fileData - Raw file bytes
 * @param {function} callback - (err) when transfer completes or fails
 */
LanTransport.prototype.sendFile = function(relativePath, fileData, callback) {
  // Prepend the path as a length-prefixed UTF-8 string
  var pathBuf = Buffer.from(relativePath, 'utf8');
  var header = Buffer.alloc(2);
  header.writeUInt16LE(pathBuf.length, 0);
  var payload = Buffer.concat([header, pathBuf, fileData]);
  this.sendReliable(C.PKT.ASSET_TRANSFER, payload, callback);
};

/**
 * Parse a received file transfer payload.
 * @param {Buffer} payload - Full reassembled payload
 * @returns {{ path: string, data: Buffer }}
 */
LanTransport.parseFileTransfer = function(payload) {
  var pathLen = payload.readUInt16LE(0);
  var path = payload.slice(2, 2 + pathLen).toString('utf8');
  var data = payload.slice(2 + pathLen);
  return { path: path, data: data };
};

// ---------------------------------------------------------------------------
// Bandwidth estimation
// ---------------------------------------------------------------------------

LanTransport.prototype._updateSendBw = function(bytes) {
  this._bytesSentWindow += bytes;
  var now = Date.now();
  var elapsed = now - this._bwWindowStart;
  if (elapsed >= 1000) {
    this.sendRateBps = Math.round((this._bytesSentWindow * 1000) / elapsed);
    this._bytesSentWindow = 0;
    this._bwWindowStart = now;
    this._emit('bandwidth', { send: this.sendRateBps, recv: this.recvRateBps });
  }
};

LanTransport.prototype._updateRecvBw = function(bytes) {
  this._bytesRecvWindow += bytes;
};

// ---------------------------------------------------------------------------
// UDP send helper
// ---------------------------------------------------------------------------

LanTransport.prototype._udpSend = function(socket, buf, ip, port) {
  if (!socket || !ip) return;
  try {
    socket.send(buf, 0, buf.length, port, ip);
    this._stats.packetsSent++;
    this._stats.bytesSent += buf.length;
    this._updateSendBw(buf.length);
  } catch (e) {
    this._emit('error', e);
  }
};

// ---------------------------------------------------------------------------
// Event system
// ---------------------------------------------------------------------------

LanTransport.prototype.on = function(event, handler) {
  if (!this._handlers[event]) this._handlers[event] = [];
  this._handlers[event].push(handler);
};

LanTransport.prototype.off = function(event, handler) {
  if (!this._handlers[event]) return;
  var idx = this._handlers[event].indexOf(handler);
  if (idx !== -1) this._handlers[event].splice(idx, 1);
};

LanTransport.prototype._emit = function(event, data) {
  var handlers = this._handlers[event];
  if (!handlers) return;
  for (var i = 0; i < handlers.length; i++) {
    try { handlers[i](data); } catch(e) {}
  }
};

// ---------------------------------------------------------------------------
// Stats / diagnostics
// ---------------------------------------------------------------------------

LanTransport.prototype.getStats = function() {
  return {
    bound: this._bound,
    peerIp: this._peerIp,
    bufferMs: this.bufferMs,
    rttMs: Math.round(this.rttMs * 100) / 100,
    rtoMs: Math.round(this._rto),
    rttVarMs: Math.round(this._rttVar * 100) / 100,
    sendRateBps: this.sendRateBps,
    recvRateBps: this.recvRateBps,
    inflightChunks: this._inflightCount,
    sendQueueLen: this._sendQueue.length,
    jitterBufLen: this._jitterBuf.length,
    reassemblyActive: Object.keys(this._reassembly).length,
    peerWindow: this._peerWindowSize,
    counters: this._stats
  };
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = LanTransport;
}

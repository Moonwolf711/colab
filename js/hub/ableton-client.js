/**
 * coLaB AbletonBridge Client
 * Node.js TCP client for AbletonBridge Remote Script on localhost:9877.
 *
 * Wire protocol: newline-delimited JSON over TCP.
 *   Send: {"type":"command_name","params":{...}}\n
 *   Recv: {"status":"success","result":{...}}\n  or  {"status":"error","message":"..."}\n
 *
 * Also supports UDP :9882 for fire-and-forget real-time parameter updates.
 *
 * Reference implementation: AbletonBridge/MCP_Server/connections/ableton.py
 *
 * @module ableton-client
 */

var net = require('net');
var dgram = require('dgram');
var C = require('../shared/constants');

// Commands that must NOT be retried (side-effects would duplicate)
var NON_IDEMPOTENT = {
  create_midi_track: true, create_audio_track: true, create_clip: true,
  create_return_track: true, create_scene: true, delete_track: true,
  delete_clip: true, delete_scene: true, delete_device: true,
  duplicate_track: true, duplicate_clip: true, duplicate_scene: true,
  add_notes_to_clip: true, add_notes_extended: true, delete_return_track: true
};

// Commands that need longer timeouts
var SLOW_TIMEOUTS = {
  freeze_track: 60000,
  unfreeze_track: 60000,
  load_instrument_or_effect: 30000,
  load_browser_item: 30000
};

var DEFAULT_TIMEOUT_MODIFYING = 15000;
var DEFAULT_TIMEOUT_READONLY = 10000;
var RECONNECT_DELAY = 1000;
var MAX_RECONNECT_ATTEMPTS = 3;

// Modifying commands (prefixes) — used to pick timeout tier
var MODIFYING_PREFIXES = ['set_', 'create_', 'delete_', 'duplicate_', 'add_', 'start_', 'stop_',
  'fire_', 'launch_', 'capture_', 'undo', 'redo', 'freeze_', 'unfreeze_', 'load_'];

// ---------------------------------------------------------------------------
// AbletonClient
// ---------------------------------------------------------------------------

function AbletonClient(options) {
  options = options || {};
  this._host = options.host || '127.0.0.1';
  this._port = options.port || C.ABLETON_BRIDGE_PORT || 9877;
  this._udpPort = options.udpPort || C.ABLETON_BRIDGE_UDP_PORT || 9882;

  this._sock = null;
  this._udpSock = null;
  this._recvBuffer = '';
  this._connected = false;
  this._connecting = false;
  this._sendQueue = [];    // queued commands during disconnect
  this._pending = null;    // current pending command: {resolve, reject, timer}
  this._sendLocked = false;

  // Echo suppression — set to true while applying remote changes
  this.suppressEcho = false;

  // Events
  this._handlers = {};
}

// ---------------------------------------------------------------------------
// Event emitter (matches colab-engine pattern)
// ---------------------------------------------------------------------------

AbletonClient.prototype.on = function(event, handler) {
  if (!this._handlers[event]) this._handlers[event] = [];
  this._handlers[event].push(handler);
};

AbletonClient.prototype.off = function(event, handler) {
  if (!this._handlers[event]) return;
  var idx = this._handlers[event].indexOf(handler);
  if (idx !== -1) this._handlers[event].splice(idx, 1);
};

AbletonClient.prototype._emit = function(event, data) {
  var handlers = this._handlers[event];
  if (!handlers) return;
  for (var i = 0; i < handlers.length; i++) {
    try { handlers[i](data); } catch(e) {}
  }
};

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

AbletonClient.prototype.connect = function() {
  var self = this;
  if (this._connected) return Promise.resolve();
  if (this._connecting) return this._connectPromise;

  this._connecting = true;
  this._connectPromise = new Promise(function(resolve, reject) {
    self._attemptConnect(0, resolve, reject);
  });

  return this._connectPromise;
};

AbletonClient.prototype._attemptConnect = function(attempt, resolve, reject) {
  var self = this;
  if (attempt >= MAX_RECONNECT_ATTEMPTS) {
    this._connecting = false;
    var err = new Error('Failed to connect to AbletonBridge after ' + MAX_RECONNECT_ATTEMPTS + ' attempts');
    this._emit('error', err);
    return reject(err);
  }

  var sock = new net.Socket();
  sock.setNoDelay(true);

  var connectTimeout = setTimeout(function() {
    sock.destroy();
    self._scheduleReconnect(attempt, resolve, reject);
  }, 5000);

  sock.connect(this._port, this._host, function() {
    clearTimeout(connectTimeout);
    self._sock = sock;
    self._recvBuffer = '';
    self._connected = true;
    self._connecting = false;
    self._emit('connected');

    // Flush queued commands
    self._flushQueue();

    resolve();
  });

  sock.on('data', function(chunk) {
    self._onData(chunk);
  });

  sock.on('error', function(err) {
    clearTimeout(connectTimeout);
    if (self._connected) {
      self._handleDisconnect('socket error: ' + err.message);
    } else {
      self._scheduleReconnect(attempt, resolve, reject);
    }
  });

  sock.on('close', function() {
    clearTimeout(connectTimeout);
    if (self._connected) {
      self._handleDisconnect('socket closed');
    }
  });
};

AbletonClient.prototype._scheduleReconnect = function(attempt, resolve, reject) {
  var self = this;
  setTimeout(function() {
    self._attemptConnect(attempt + 1, resolve, reject);
  }, RECONNECT_DELAY);
};

AbletonClient.prototype._handleDisconnect = function(reason) {
  this._connected = false;
  if (this._sock) {
    try { this._sock.destroy(); } catch(e) {}
    this._sock = null;
  }
  this._recvBuffer = '';

  // Reject any pending command
  if (this._pending) {
    clearTimeout(this._pending.timer);
    this._pending.reject(new Error('Disconnected: ' + reason));
    this._pending = null;
  }
  this._sendLocked = false;

  this._emit('disconnected', reason);

  // Auto-reconnect after 2 seconds
  if (!this._reconnectTimer && !this._intentionalDisconnect) {
    var self = this;
    this._reconnectTimer = setTimeout(function() {
      self._reconnectTimer = null;
      if (!self._connected && !self._connecting) {
        self._emit('reconnecting');
        self.connect().then(function() {
          self._emit('reconnected');
        }).catch(function() {
          // Will trigger _handleDisconnect again → retry
        });
      }
    }, 2000);
  }
};

AbletonClient.prototype.disconnect = function() {
  this._intentionalDisconnect = true;
  if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
  this._connected = false;
  this._connecting = false;
  if (this._sock) {
    try { this._sock.destroy(); } catch(e) {}
    this._sock = null;
  }
  if (this._udpSock) {
    try { this._udpSock.close(); } catch(e) {}
    this._udpSock = null;
  }
  this._recvBuffer = '';
  if (this._pending) {
    clearTimeout(this._pending.timer);
    this._pending.reject(new Error('Client disconnected'));
    this._pending = null;
  }
  this._sendLocked = false;
  this._sendQueue = [];
};

AbletonClient.prototype.isConnected = function() {
  return this._connected;
};

// ---------------------------------------------------------------------------
// TCP receive: buffer accumulation + newline-delimited JSON parsing
// ---------------------------------------------------------------------------

AbletonClient.prototype._onData = function(chunk) {
  this._recvBuffer += chunk.toString('utf8');

  // Process all complete lines in the buffer
  var nlIdx;
  while ((nlIdx = this._recvBuffer.indexOf('\n')) !== -1) {
    var line = this._recvBuffer.substring(0, nlIdx).trim();
    this._recvBuffer = this._recvBuffer.substring(nlIdx + 1);

    if (line.length === 0) continue;

    try {
      var response = JSON.parse(line);
      this._onResponse(response);
    } catch(e) {
      this._emit('error', new Error('Malformed JSON from AbletonBridge: ' + line.substring(0, 200)));
    }
  }
};

AbletonClient.prototype._onResponse = function(response) {
  if (!this._pending) return; // no command waiting — unexpected response

  var pending = this._pending;
  this._pending = null;
  clearTimeout(pending.timer);
  this._sendLocked = false;

  if (response.status === 'error') {
    pending.reject(new Error(response.message || 'Unknown error from Ableton'));
  } else {
    pending.resolve(response.result || {});
  }

  // Process next queued command
  this._flushQueue();
};

// ---------------------------------------------------------------------------
// TCP send: serialized command queue with send lock
// ---------------------------------------------------------------------------

AbletonClient.prototype.send = function(type, params) {
  var self = this;
  return new Promise(function(resolve, reject) {
    var cmd = { type: type, params: params || {}, resolve: resolve, reject: reject };

    if (!self._connected) {
      // Queue for later
      self._sendQueue.push(cmd);
      return;
    }

    if (self._sendLocked) {
      // Another command is in-flight, queue this one
      self._sendQueue.push(cmd);
      return;
    }

    self._executeSend(cmd);
  });
};

AbletonClient.prototype._executeSend = function(cmd) {
  var self = this;
  this._sendLocked = true;

  var isModifying = this._isModifying(cmd.type);
  var timeout = SLOW_TIMEOUTS[cmd.type] || (isModifying ? DEFAULT_TIMEOUT_MODIFYING : DEFAULT_TIMEOUT_READONLY);
  var canRetry = !NON_IDEMPOTENT[cmd.type];

  var message = JSON.stringify({ type: cmd.type, params: cmd.params }) + '\n';

  this._pending = {
    resolve: cmd.resolve,
    reject: cmd.reject,
    type: cmd.type,
    canRetry: canRetry,
    timer: setTimeout(function() {
      self._pending = null;
      self._sendLocked = false;
      cmd.reject(new Error('Command timed out: ' + cmd.type + ' (' + timeout + 'ms)'));
      self._flushQueue();
    }, timeout)
  };

  try {
    this._sock.write(message);
  } catch(e) {
    clearTimeout(this._pending.timer);
    this._pending = null;
    this._sendLocked = false;

    if (canRetry) {
      // Reconnect and retry once
      this._handleDisconnect('send error: ' + e.message);
      var self2 = this;
      this.connect().then(function() {
        self2.send(cmd.type, cmd.params).then(cmd.resolve, cmd.reject);
      }).catch(cmd.reject);
    } else {
      cmd.reject(new Error('Send failed (non-idempotent, no retry): ' + e.message));
    }
  }
};

AbletonClient.prototype._flushQueue = function() {
  if (this._sendLocked || this._sendQueue.length === 0 || !this._connected) return;
  var next = this._sendQueue.shift();
  this._executeSend(next);
};

AbletonClient.prototype._isModifying = function(type) {
  for (var i = 0; i < MODIFYING_PREFIXES.length; i++) {
    if (type.indexOf(MODIFYING_PREFIXES[i]) === 0) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// UDP send: fire-and-forget for real-time parameter updates
// ---------------------------------------------------------------------------

AbletonClient.prototype.sendUDP = function(type, params) {
  if (!this._udpSock) {
    this._udpSock = dgram.createSocket('udp4');
  }
  var message = JSON.stringify({ type: type, params: params || {} });
  var buf = Buffer.from(message, 'utf8');
  this._udpSock.send(buf, 0, buf.length, this._udpPort, this._host);
};

// ---------------------------------------------------------------------------
// Convenience methods (built on send())
// ---------------------------------------------------------------------------

AbletonClient.prototype.getSessionInfo = function() {
  return this.send('get_session_info');
};

AbletonClient.prototype.getSelectionState = function() {
  return this.send('get_selection_state');
};

AbletonClient.prototype.getAllTracksInfo = function() {
  return this.send('get_all_tracks_info');
};

AbletonClient.prototype.setTempo = function(tempo) {
  return this.send('set_tempo', { tempo: tempo });
};

AbletonClient.prototype.setTrackVolume = function(trackIndex, volume) {
  return this.send('set_track_volume', { track_index: trackIndex, volume: volume });
};

AbletonClient.prototype.setTrackPan = function(trackIndex, pan) {
  return this.send('set_track_pan', { track_index: trackIndex, pan: pan });
};

AbletonClient.prototype.setTrackMute = function(trackIndex, mute) {
  return this.send('set_track_mute', { track_index: trackIndex, mute: mute });
};

AbletonClient.prototype.setTrackSolo = function(trackIndex, solo) {
  return this.send('set_track_solo', { track_index: trackIndex, solo: solo });
};

AbletonClient.prototype.setTrackArm = function(trackIndex, arm) {
  return this.send('set_track_arm', { track_index: trackIndex, arm: arm });
};

AbletonClient.prototype.setTrackSend = function(trackIndex, sendIndex, value) {
  return this.send('set_track_send', { track_index: trackIndex, send_index: sendIndex, value: value });
};

AbletonClient.prototype.selectTrack = function(trackIndex, trackType) {
  return this.send('select_track', { track_index: trackIndex, track_type: trackType || 'track' });
};

AbletonClient.prototype.startPlayback = function() {
  return this.send('start_playback');
};

AbletonClient.prototype.stopPlayback = function() {
  return this.send('stop_playback');
};

// Fast param update via UDP (no response, no blocking)
AbletonClient.prototype.setTrackVolumeUDP = function(trackIndex, volume) {
  this.sendUDP('set_track_volume', { track_index: trackIndex, volume: volume });
};

AbletonClient.prototype.setTrackPanUDP = function(trackIndex, pan) {
  this.sendUDP('set_track_pan', { track_index: trackIndex, pan: pan });
};

AbletonClient.prototype.setDeviceParameterUDP = function(trackIndex, deviceIndex, paramName, value) {
  this.sendUDP('set_device_parameter', {
    track_index: trackIndex, device_index: deviceIndex,
    parameter_name: paramName, value: value
  });
};

// ---------------------------------------------------------------------------
// Device methods
// ---------------------------------------------------------------------------

AbletonClient.prototype.getTrackDevices = function(trackIndex) {
  return this.send('get_track_devices', { track_index: trackIndex });
};

AbletonClient.prototype.getDeviceParameters = function(trackIndex, deviceIndex) {
  return this.send('get_device_parameters', { track_index: trackIndex, device_index: deviceIndex });
};

AbletonClient.prototype.setDeviceParameter = function(trackIndex, deviceIndex, paramIndex, value) {
  return this.send('set_device_parameter', {
    track_index: trackIndex, device_index: deviceIndex,
    parameter_index: paramIndex, value: value
  });
};

AbletonClient.prototype.insertDeviceByName = function(trackIndex, deviceName) {
  return this.send('insert_device_by_name', { track_index: trackIndex, device_name: deviceName });
};

AbletonClient.prototype.deleteDevice = function(trackIndex, deviceIndex) {
  return this.send('delete_device', { track_index: trackIndex, device_index: deviceIndex });
};

// ---------------------------------------------------------------------------
// Clip methods
// ---------------------------------------------------------------------------

AbletonClient.prototype.getTrackClips = function(trackIndex) {
  return this.send('get_track_clips', { track_index: trackIndex });
};

AbletonClient.prototype.getClipNotes = function(trackIndex, clipIndex) {
  return this.send('get_clip_notes', { track_index: trackIndex, clip_index: clipIndex });
};

AbletonClient.prototype.addNotesToClip = function(trackIndex, clipIndex, notes) {
  return this.send('add_notes_to_clip', { track_index: trackIndex, clip_index: clipIndex, notes: notes });
};

AbletonClient.prototype.removeNotesFromClip = function(trackIndex, clipIndex, fromTime, toTime, fromPitch, toPitch) {
  return this.send('remove_notes_from_clip', {
    track_index: trackIndex, clip_index: clipIndex,
    from_time: fromTime || 0, to_time: toTime || 9999,
    from_pitch: fromPitch || 0, to_pitch: toPitch || 127
  });
};

AbletonClient.prototype.createClip = function(trackIndex, clipIndex, length) {
  return this.send('create_clip', { track_index: trackIndex, clip_index: clipIndex, length: length || 4 });
};

AbletonClient.prototype.deleteClip = function(trackIndex, clipIndex) {
  return this.send('delete_clip', { track_index: trackIndex, clip_index: clipIndex });
};

AbletonClient.prototype.fireClip = function(trackIndex, clipIndex) {
  return this.send('fire_clip', { track_index: trackIndex, clip_index: clipIndex });
};

AbletonClient.prototype.stopClip = function(trackIndex, clipIndex) {
  return this.send('stop_clip', { track_index: trackIndex, clip_index: clipIndex });
};

AbletonClient.prototype.duplicateClip = function(trackIndex, clipIndex) {
  return this.send('duplicate_clip', { track_index: trackIndex, clip_index: clipIndex });
};

// ---------------------------------------------------------------------------
// Automation methods
// ---------------------------------------------------------------------------

AbletonClient.prototype.getClipAutomation = function(trackIndex, clipIndex, paramId) {
  return this.send('get_clip_automation', { track_index: trackIndex, clip_index: clipIndex, parameter_id: paramId });
};

AbletonClient.prototype.createClipAutomation = function(trackIndex, clipIndex, paramId, points) {
  return this.send('create_clip_automation', {
    track_index: trackIndex, clip_index: clipIndex,
    parameter_id: paramId, points: points
  });
};

// ---------------------------------------------------------------------------
// Scene methods
// ---------------------------------------------------------------------------

AbletonClient.prototype.createScene = function(sceneIndex) {
  return this.send('create_scene', { scene_index: sceneIndex });
};

AbletonClient.prototype.deleteScene = function(sceneIndex) {
  return this.send('delete_scene', { scene_index: sceneIndex });
};

AbletonClient.prototype.fireScene = function(sceneIndex) {
  return this.send('fire_scene', { scene_index: sceneIndex });
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = AbletonClient;
}

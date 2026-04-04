/**
 * coLaB Sync Controller
 * Master orchestrator for AbletonBridge-based real-time collaboration.
 * Manages AbletonClient, CursorSync, ParamSync, and audio toggle state.
 * Provides unified API for the web-bridge dashboard.
 *
 * @module sync-controller
 */

var fs = require('fs');
var path = require('path');
var AbletonClient = require('./ableton-client');
var CursorSync = require('./cursor-sync');
var ParamSync = require('./param-sync');
var C = require('../shared/constants');

var PREFS_FILE = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.colab-sync-prefs.json');
var MAX_CHANGE_LOG = 200;

// Default sync configuration
var DEFAULT_CONFIG = {
  cursor: true,
  transport: true,
  mixer: true,
  devices: true,
  clips: true,
  notes: true,
  automation: true,
  audioMonitor: false,
  trackOverrides: {}  // {trackIndex: {mixer: bool}}
};

function SyncController(engine, options) {
  options = options || {};
  this._engine = engine;
  this._userId = options.userId || 'local';

  // Create TWO AbletonClients — one for reads (polling), one for writes (applies)
  // AbletonBridge Remote Script accepts multiple TCP connections
  this._client = new AbletonClient({
    host: options.abletonHost || '127.0.0.1',
    port: options.abletonPort || C.ABLETON_BRIDGE_PORT,
    udpPort: options.abletonUdpPort || C.ABLETON_BRIDGE_UDP_PORT
  });
  this._writeClient = new AbletonClient({
    host: options.abletonHost || '127.0.0.1',
    port: options.abletonPort || C.ABLETON_BRIDGE_PORT,
    udpPort: options.abletonUdpPort || C.ABLETON_BRIDGE_UDP_PORT
  });

  // Create sub-modules — polling uses _client, applies use _writeClient
  this._cursorSync = new CursorSync(this._client, engine, { userId: this._userId });
  this._paramSync = new ParamSync(this._client, engine, { userId: this._userId, writeClient: this._writeClient });

  // Sync configuration
  this._config = this._loadPrefs() || JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // Change log (recent changes for dashboard)
  this._changeLog = [];

  // State
  this._started = false;
  this._abletonConnected = false;

  // Events
  this._handlers = {};

  // Wire sub-module events
  this._wireEvents();
}

// ---------------------------------------------------------------------------
// Event emitter
// ---------------------------------------------------------------------------

SyncController.prototype.on = function(event, handler) {
  if (!this._handlers[event]) this._handlers[event] = [];
  this._handlers[event].push(handler);
};

SyncController.prototype.off = function(event, handler) {
  if (!this._handlers[event]) return;
  var idx = this._handlers[event].indexOf(handler);
  if (idx !== -1) this._handlers[event].splice(idx, 1);
};

SyncController.prototype._emit = function(event, data) {
  var handlers = this._handlers[event];
  if (!handlers) return;
  for (var i = 0; i < handlers.length; i++) {
    try { handlers[i](data); } catch(e) {}
  }
};

// ---------------------------------------------------------------------------
// Wire sub-module events into unified change feed
// ---------------------------------------------------------------------------

SyncController.prototype._wireEvents = function() {
  var self = this;

  // AbletonClient connection events
  this._client.on('connected', function() {
    self._abletonConnected = true;
    self._emit('ableton_connected');
    self._logChange('system', 'Connected to AbletonBridge');
  });

  this._client.on('disconnected', function(reason) {
    self._abletonConnected = false;
    self._emit('ableton_disconnected', reason);
    self._logChange('system', 'Disconnected from AbletonBridge: ' + reason);
  });

  this._client.on('error', function(err) {
    self._emit('error', err);
  });

  // CursorSync events — also feed focused track into param-sync for deep polling
  this._cursorSync.on('partner_cursor', function(data) {
    self._emit('partner_cursor', data);
  });

  this._cursorSync.on('local_cursor', function(data) {
    self._emit('local_cursor', data);
    // Update param-sync focus so deep polling targets the track we're editing
    if (data.track >= 0) self._paramSync.setFocusedTrack(data.track);
    if (data.scene >= 0) self._paramSync.setFocusedClip(data.scene);
  });

  // ParamSync events
  this._paramSync.on('local_change', function(data) {
    self._logChange('local', self._formatChange(data));
    self._emit('param_change', { source: 'local', change: data });
  });

  this._paramSync.on('remote_change', function(data) {
    self._logChange('partner', self._formatChange(data));
    self._emit('param_change', { source: 'partner', change: data });
  });

  this._paramSync.on('conflict', function(data) {
    self._logChange('conflict', 'Both touched ' + data.paramKey + ' — ' + data.winner + ' wins');
    self._emit('conflict', data);
  });

  this._paramSync.on('remote_applied', function(data) {
    self._logChange('system', 'Applied: Track ' + data.track + ' ' + data.param + ' = ' + data.value);
  });

  this._paramSync.on('remote_apply_error', function(data) {
    self._logChange('error', 'Failed to apply Track ' + data.track + ' ' + data.param + ': ' + data.error);
    self._emit('error', data);
  });
};

SyncController.prototype._formatChange = function(data) {
  var target = data.track === -1 ? 'Transport' : ('Track ' + data.track);
  if (typeof data.oldValue === 'boolean') {
    return target + ' ' + data.param + ': ' + (data.newValue ? 'ON' : 'OFF');
  }
  if (typeof data.newValue === 'number') {
    var oldStr = typeof data.oldValue === 'number' ? data.oldValue.toFixed(2) : '?';
    return target + ' ' + data.param + ': ' + oldStr + ' → ' + data.newValue.toFixed(2);
  }
  return target + ' ' + data.param + ' changed';
};

SyncController.prototype._logChange = function(source, text) {
  var entry = {
    id: this._changeLog.length,
    source: source,
    text: text,
    timestamp: Date.now()
  };
  this._changeLog.push(entry);
  if (this._changeLog.length > MAX_CHANGE_LOG) {
    this._changeLog.shift();
  }
  this._emit('change_logged', entry);
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

SyncController.prototype.start = function(callback) {
  if (this._started) {
    if (callback) callback(null);
    return;
  }

  var self = this;
  // Connect both read and write clients
  Promise.all([
    this._client.connect(),
    this._writeClient.connect()
  ]).then(function() {
    self._started = true;

    // Apply config to sub-modules
    self._applyConfig();

    // Start sub-modules
    if (self._config.cursor) self._cursorSync.start();
    self._paramSync.start();

    self._logChange('system', 'LiveSync started (dual connection)');
    self._emit('started');

    if (callback) callback(null);
  }).catch(function(err) {
    self._logChange('system', 'Failed to start: ' + err.message);
    self._emit('error', err);

    // Start without Ableton connection — will reconnect
    self._started = true;
    if (callback) callback(err);
  });
};

SyncController.prototype.stop = function() {
  this._started = false;
  this._cursorSync.stop();
  this._paramSync.stop();
  this._client.disconnect();
  this._writeClient.disconnect();
  this._logChange('system', 'LiveSync stopped');
  this._emit('stopped');
};

// ---------------------------------------------------------------------------
// Sync configuration
// ---------------------------------------------------------------------------

SyncController.prototype.getConfig = function() {
  return JSON.parse(JSON.stringify(this._config));
};

SyncController.prototype.setConfig = function(newConfig) {
  // Merge with current config
  if (newConfig.cursor !== undefined) this._config.cursor = newConfig.cursor;
  if (newConfig.transport !== undefined) this._config.transport = newConfig.transport;
  if (newConfig.mixer !== undefined) this._config.mixer = newConfig.mixer;
  if (newConfig.devices !== undefined) this._config.devices = newConfig.devices;
  if (newConfig.clips !== undefined) this._config.clips = newConfig.clips;
  if (newConfig.notes !== undefined) this._config.notes = newConfig.notes;
  if (newConfig.automation !== undefined) this._config.automation = newConfig.automation;
  if (newConfig.audioMonitor !== undefined) this._config.audioMonitor = newConfig.audioMonitor;
  if (newConfig.trackOverrides) {
    var keys = Object.keys(newConfig.trackOverrides);
    for (var i = 0; i < keys.length; i++) {
      this._config.trackOverrides[keys[i]] = newConfig.trackOverrides[keys[i]];
    }
  }

  this._applyConfig();
  this._savePrefs();
  this._emit('config_changed', this._config);
  return this._config;
};

SyncController.prototype.setTrackOverride = function(trackIndex, overrides) {
  this._config.trackOverrides[trackIndex] = overrides;
  this._paramSync.setTrackSync(trackIndex, overrides);
  this._savePrefs();
  this._emit('config_changed', this._config);
};

SyncController.prototype._applyConfig = function() {
  // Cursor sync
  this._cursorSync.setEnabled(this._config.cursor);
  if (this._config.cursor && this._started && !this._cursorSync._pollTimer) {
    this._cursorSync.start();
  } else if (!this._config.cursor) {
    this._cursorSync.stop();
  }

  // Param sync — master enable + per-layer toggles
  this._paramSync.setEnabled(this._config.mixer || this._config.transport || this._config.devices || this._config.clips);
  this._paramSync.setLayerEnabled('mixer', this._config.mixer);
  this._paramSync.setLayerEnabled('devices', this._config.devices);
  this._paramSync.setLayerEnabled('clips', this._config.clips);
  this._paramSync.setLayerEnabled('notes', this._config.notes);
  this._paramSync.setLayerEnabled('automation', this._config.automation);

  // Per-track overrides
  var overrides = this._config.trackOverrides;
  var keys = Object.keys(overrides);
  for (var i = 0; i < keys.length; i++) {
    this._paramSync.setTrackSync(parseInt(keys[i]), overrides[keys[i]]);
  }
};

// ---------------------------------------------------------------------------
// Audio toggle (controls param-sync filtering + PCM stream mute)
// ---------------------------------------------------------------------------

SyncController.prototype.setAudioMonitor = function(enabled) {
  this._config.audioMonitor = enabled;
  // If engine has PCM audio, toggle mute
  if (this._engine.audio) {
    // PcmMixer mute control — mute all channels when audio monitor is off
    if (typeof this._engine.audio.setMuted === 'function') {
      this._engine.audio.setMuted(!enabled);
    }
  }
  this._savePrefs();
  this._emit('config_changed', this._config);
};

SyncController.prototype.setMixerSync = function(enabled) {
  this._config.mixer = enabled;
  this._applyConfig();
  this._savePrefs();
  this._logChange('system', 'Mixer sync ' + (enabled ? 'enabled' : 'disabled'));
  this._emit('config_changed', this._config);
};

SyncController.prototype.setTrackMixerSync = function(trackIndex, enabled) {
  this.setTrackOverride(trackIndex, { mixer: enabled });
  this._logChange('system', 'Track ' + trackIndex + ' mixer sync ' + (enabled ? 'enabled' : 'disabled'));
};

// ---------------------------------------------------------------------------
// Full state (for dashboard)
// ---------------------------------------------------------------------------

SyncController.prototype.getFullState = function() {
  return {
    started: this._started,
    abletonConnected: this._abletonConnected,
    config: this.getConfig(),
    partnerCursor: this._cursorSync.getPartnerCursor(),
    localCursor: this._cursorSync.getLocalCursor(),
    snapshot: this._paramSync.getSnapshot(),
    changeLog: this._changeLog.slice(-50),  // last 50 for dashboard
    peerConnected: this._engine._connected || false,
    peerIp: this._engine.peerIp || null
  };
};

// ---------------------------------------------------------------------------
// Preferences persistence
// ---------------------------------------------------------------------------

SyncController.prototype._savePrefs = function() {
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(this._config, null, 2));
  } catch(e) {
    // Non-critical — prefs just won't persist
  }
};

SyncController.prototype._loadPrefs = function() {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      var data = fs.readFileSync(PREFS_FILE, 'utf8');
      var parsed = JSON.parse(data);
      // Validate structure
      if (typeof parsed.cursor === 'boolean' && typeof parsed.mixer === 'boolean') {
        return parsed;
      }
    }
  } catch(e) {}
  return null;
};

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

SyncController.prototype.getClient = function() {
  return this._client;
};

SyncController.prototype.getWriteClient = function() {
  return this._writeClient;
};

SyncController.prototype.getCursorSync = function() {
  return this._cursorSync;
};

SyncController.prototype.getParamSync = function() {
  return this._paramSync;
};

SyncController.prototype.getChangeLog = function() {
  return this._changeLog;
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = SyncController;
}

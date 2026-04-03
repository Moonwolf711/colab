/**
 * coLaB Parameter Sync
 * Polls Ableton track params and transport via AbletonBridge TCP client,
 * diffs against snapshot, sends deltas to peer, applies received deltas.
 *
 * Echo loop prevention: tracks recently-applied remote changes by param key + timestamp.
 * When polling detects a change that matches a recent remote apply (<100ms), it's suppressed.
 *
 * @module param-sync
 */

var C = require('../shared/constants');

var PARAM_POLL_MS = C.PARAM_DEBOUNCE_MS * 2;    // ~60ms = ~16Hz
var TRANSPORT_POLL_MS = 200;                      // 5Hz for tempo/playing
var ECHO_SUPPRESS_MS = 150;                       // ignore self-changes within this window
var CONFLICT_WINDOW_MS = 500;                     // two users touching same param = conflict

// Track params we sync
var SYNCED_TRACK_PARAMS = ['volume', 'pan', 'mute', 'solo', 'arm', 'color', 'name'];

function ParamSync(abletonClient, engine, options) {
  options = options || {};
  this._client = abletonClient;
  this._engine = engine;
  this._userId = options.userId || 'local';

  this._paramPollTimer = null;
  this._transportPollTimer = null;
  this._enabled = true;

  // Snapshot: last known state of all tracks and transport
  this._trackSnapshot = [];   // [{volume, pan, mute, solo, arm}, ...]
  this._transportSnapshot = { tempo: 0, playing: false };

  // Echo suppression: {paramKey: timestamp} of recently-applied remote changes
  this._recentRemoteApply = {};

  // Conflict tracking: {paramKey: {local: timestamp, remote: timestamp}}
  this._recentLocalChange = {};

  // Per-track sync toggles: {trackIndex: {mixer: bool}}
  this._trackSyncConfig = {};

  // Events
  this._handlers = {};

  // Wire incoming state events from engine (partner's param changes)
  var self = this;
  this._engineStateHandler = function(data) {
    self._onPeerState(data);
  };
}

// ---------------------------------------------------------------------------
// Event emitter
// ---------------------------------------------------------------------------

ParamSync.prototype.on = function(event, handler) {
  if (!this._handlers[event]) this._handlers[event] = [];
  this._handlers[event].push(handler);
};

ParamSync.prototype._emit = function(event, data) {
  var handlers = this._handlers[event];
  if (!handlers) return;
  for (var i = 0; i < handlers.length; i++) {
    try { handlers[i](data); } catch(e) {}
  }
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

ParamSync.prototype.start = function() {
  this.stop();
  this._engine.on('state', this._engineStateHandler);

  // Take initial snapshot
  var self = this;
  this._takeInitialSnapshot().then(function() {
    // Start polling after initial snapshot
    self._paramPollTimer = setInterval(self._pollParams.bind(self), PARAM_POLL_MS);
    self._transportPollTimer = setInterval(self._pollTransport.bind(self), TRANSPORT_POLL_MS);
  }).catch(function(err) {
    // Start polling anyway — snapshot will build on first successful poll
    self._paramPollTimer = setInterval(self._pollParams.bind(self), PARAM_POLL_MS);
    self._transportPollTimer = setInterval(self._pollTransport.bind(self), TRANSPORT_POLL_MS);
  });
};

ParamSync.prototype.stop = function() {
  if (this._paramPollTimer) {
    clearInterval(this._paramPollTimer);
    this._paramPollTimer = null;
  }
  if (this._transportPollTimer) {
    clearInterval(this._transportPollTimer);
    this._transportPollTimer = null;
  }
  this._engine.off('state', this._engineStateHandler);
};

ParamSync.prototype._takeInitialSnapshot = function() {
  var self = this;
  return Promise.all([
    this._client.getAllTracksInfo(),
    this._client.getSessionInfo()
  ]).then(function(results) {
    var tracks = results[0];
    var session = results[1];

    // Build track snapshot
    self._trackSnapshot = [];
    if (Array.isArray(tracks)) {
      for (var i = 0; i < tracks.length; i++) {
        self._trackSnapshot.push(self._extractTrackParams(tracks[i]));
      }
    } else if (tracks && Array.isArray(tracks.tracks)) {
      for (var j = 0; j < tracks.tracks.length; j++) {
        self._trackSnapshot.push(self._extractTrackParams(tracks.tracks[j]));
      }
    }

    // Build transport snapshot
    self._transportSnapshot = {
      tempo: session.tempo || 120,
      playing: !!session.is_playing
    };
  });
};

ParamSync.prototype._extractTrackParams = function(track) {
  return {
    volume: track.volume !== undefined ? track.volume : 0.85,
    pan: track.panning !== undefined ? track.panning : (track.pan !== undefined ? track.pan : 0),
    mute: !!track.mute,
    solo: !!track.solo,
    arm: !!track.arm,
    color: track.color_index !== undefined ? track.color_index : (track.color !== undefined ? track.color : -1),
    name: track.name || ''
  };
};

// ---------------------------------------------------------------------------
// Polling: detect local changes, send deltas
// ---------------------------------------------------------------------------

ParamSync.prototype._pollParams = function() {
  if (!this._enabled || !this._client.isConnected()) return;

  var self = this;
  this._client.getAllTracksInfo().then(function(result) {
    var tracks = Array.isArray(result) ? result : (result && result.tracks ? result.tracks : []);
    var now = Date.now();

    // Grow snapshot if tracks were added
    while (self._trackSnapshot.length < tracks.length) {
      self._trackSnapshot.push({ volume: 0.85, pan: 0, mute: false, solo: false, arm: false, color: -1, name: '' });
    }

    for (var i = 0; i < tracks.length; i++) {
      var current = self._extractTrackParams(tracks[i]);
      var snapshot = self._trackSnapshot[i];
      if (!snapshot) continue;

      for (var p = 0; p < SYNCED_TRACK_PARAMS.length; p++) {
        var param = SYNCED_TRACK_PARAMS[p];
        var oldVal = snapshot[param];
        var newVal = current[param];

        if (oldVal !== newVal) {
          // Check echo suppression — was this change caused by a remote apply?
          var paramKey = i + ':' + param;
          var suppressUntil = self._recentRemoteApply[paramKey];
          if (suppressUntil && now < suppressUntil) {
            // This change was caused by us applying a remote delta — don't re-broadcast
            snapshot[param] = newVal;
            continue;
          }

          // Genuine local change — update snapshot and broadcast
          snapshot[param] = newVal;

          // Check for conflict (partner changed same param recently)
          self._checkConflict(paramKey, 'local', now);
          self._recentLocalChange[paramKey] = now;

          // Send delta to peer
          self._engine.sendParam(i, param, newVal);

          self._emit('local_change', {
            track: i,
            trackName: tracks[i].name || ('Track ' + (i + 1)),
            param: param,
            oldValue: oldVal,
            newValue: newVal,
            timestamp: now
          });
        }
      }
    }
  }).catch(function() {
    // Silently ignore polling errors
  });
};

ParamSync.prototype._pollTransport = function() {
  if (!this._enabled || !this._client.isConnected()) return;

  var self = this;
  this._client.getSessionInfo().then(function(session) {
    var now = Date.now();
    var tempo = session.tempo || 120;
    var playing = !!session.is_playing;

    // Tempo change
    if (Math.abs(tempo - self._transportSnapshot.tempo) > 0.01) {
      var tempoKey = 'transport:tempo';
      var suppressUntil = self._recentRemoteApply[tempoKey];
      if (!suppressUntil || now >= suppressUntil) {
        var oldTempo = self._transportSnapshot.tempo;
        self._transportSnapshot.tempo = tempo;
        self._engine.sendTransport(undefined, tempo);
        self._emit('local_change', {
          track: -1, param: 'tempo',
          oldValue: oldTempo, newValue: tempo, timestamp: now
        });
      } else {
        self._transportSnapshot.tempo = tempo;
      }
    }

    // Playing state change
    if (playing !== self._transportSnapshot.playing) {
      var playKey = 'transport:playing';
      var suppressUntilPlay = self._recentRemoteApply[playKey];
      if (!suppressUntilPlay || now >= suppressUntilPlay) {
        self._transportSnapshot.playing = playing;
        self._engine.sendTransport(playing, undefined);
        self._emit('local_change', {
          track: -1, param: 'playing',
          oldValue: !playing, newValue: playing, timestamp: now
        });
      } else {
        self._transportSnapshot.playing = playing;
      }
    }
  }).catch(function() {});
};

// ---------------------------------------------------------------------------
// Incoming: apply peer parameter changes
// ---------------------------------------------------------------------------

ParamSync.prototype._onPeerState = function(data) {
  if (!this._enabled) return;
  if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) return;

  var payload;
  try {
    payload = JSON.parse(data.slice(5).toString('utf8'));
  } catch(e) {
    return;
  }

  var now = Date.now();

  if (payload.type === 'param') {
    this._applyRemoteParam(payload.track, payload.param, payload.value, now);
  }

  if (payload.type === 'transport') {
    if (payload.tempo !== undefined) {
      this._applyRemoteTransport('tempo', payload.tempo, now);
    }
    if (payload.playing !== undefined) {
      this._applyRemoteTransport('playing', payload.playing, now);
    }
  }
};

ParamSync.prototype._applyRemoteParam = function(trackIdx, param, value, now) {
  // Check per-track sync config
  var config = this._trackSyncConfig[trackIdx];
  if (config && config.mixer === false) return;

  var paramKey = trackIdx + ':' + param;

  // Record that we're about to apply a remote change (for echo suppression)
  this._recentRemoteApply[paramKey] = now + ECHO_SUPPRESS_MS;

  // Check for conflict
  this._checkConflict(paramKey, 'remote', now);

  // Update local snapshot
  if (this._trackSnapshot[trackIdx]) {
    this._trackSnapshot[trackIdx][param] = value;
  }

  // Apply to Ableton via TCP or UDP
  var self = this;
  var applyPromise;

  // Use UDP for continuous params (volume, pan) — faster, no blocking
  // Use TCP for discrete params (mute, solo, arm) — needs confirmation
  if (param === 'volume') {
    this._client.setTrackVolumeUDP(trackIdx, value);
    applyPromise = Promise.resolve();
  } else if (param === 'pan') {
    this._client.setTrackPanUDP(trackIdx, value);
    applyPromise = Promise.resolve();
  } else if (param === 'mute') {
    applyPromise = this._client.setTrackMute(trackIdx, value);
  } else if (param === 'solo') {
    applyPromise = this._client.setTrackSolo(trackIdx, value);
  } else if (param === 'arm') {
    applyPromise = this._client.setTrackArm(trackIdx, value);
  } else if (param === 'color') {
    applyPromise = this._client.send('set_track_color', { track_index: trackIdx, color_index: value });
  } else if (param === 'name') {
    applyPromise = this._client.send('set_track_name', { track_index: trackIdx, name: value });
  }

  if (applyPromise) {
    applyPromise.catch(function() {});
  }

  this._emit('remote_change', {
    track: trackIdx, param: param, value: value, timestamp: now
  });
};

ParamSync.prototype._applyRemoteTransport = function(param, value, now) {
  var paramKey = 'transport:' + param;
  this._recentRemoteApply[paramKey] = now + ECHO_SUPPRESS_MS;

  if (param === 'tempo') {
    this._transportSnapshot.tempo = value;
    this._client.setTempo(value).catch(function() {});
  } else if (param === 'playing') {
    this._transportSnapshot.playing = value;
    if (value) {
      this._client.startPlayback().catch(function() {});
    } else {
      this._client.stopPlayback().catch(function() {});
    }
  }

  this._emit('remote_change', {
    track: -1, param: param, value: value, timestamp: now
  });
};

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

ParamSync.prototype._checkConflict = function(paramKey, source, now) {
  if (source === 'local') {
    // Check if partner also changed this recently
    var lastRemote = this._recentRemoteApply[paramKey];
    if (lastRemote && (now - (lastRemote - ECHO_SUPPRESS_MS)) < CONFLICT_WINDOW_MS) {
      this._emit('conflict', { paramKey: paramKey, winner: 'local', timestamp: now });
    }
  } else if (source === 'remote') {
    var lastLocal = this._recentLocalChange[paramKey];
    if (lastLocal && (now - lastLocal) < CONFLICT_WINDOW_MS) {
      this._emit('conflict', { paramKey: paramKey, winner: 'remote', timestamp: now });
    }
  }
};

// ---------------------------------------------------------------------------
// Per-track sync configuration
// ---------------------------------------------------------------------------

ParamSync.prototype.setTrackSync = function(trackIndex, config) {
  this._trackSyncConfig[trackIndex] = config;
};

ParamSync.prototype.getTrackSync = function(trackIndex) {
  return this._trackSyncConfig[trackIndex] || { mixer: true };
};

ParamSync.prototype.setEnabled = function(enabled) {
  this._enabled = enabled;
};

ParamSync.prototype.getSnapshot = function() {
  return {
    tracks: this._trackSnapshot,
    transport: this._transportSnapshot
  };
};

// Periodic cleanup of stale echo suppression entries
ParamSync.prototype._cleanupSuppression = function() {
  var now = Date.now();
  var keys = Object.keys(this._recentRemoteApply);
  for (var i = 0; i < keys.length; i++) {
    if (this._recentRemoteApply[keys[i]] < now) {
      delete this._recentRemoteApply[keys[i]];
    }
  }
  keys = Object.keys(this._recentLocalChange);
  for (var j = 0; j < keys.length; j++) {
    if ((now - this._recentLocalChange[keys[j]]) > CONFLICT_WINDOW_MS * 2) {
      delete this._recentLocalChange[keys[j]];
    }
  }
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = ParamSync;
}

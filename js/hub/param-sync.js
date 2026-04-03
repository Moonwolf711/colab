/**
 * coLaB Parameter Sync (Full)
 * Syncs ALL Ableton state between peers via AbletonBridge TCP polling + diff.
 *
 * Sync layers (tiered by frequency):
 *   Tier 1 (16Hz) — Mixer: volume, pan, mute, solo, arm, color, name
 *   Tier 2 (2Hz)  — Structure: device list, clip slots (rotates through tracks)
 *   Tier 3 (4Hz)  — Deep: device params, clip notes, automation (focused track only)
 *   Transport (5Hz) — tempo, playing state
 *
 * Echo loop prevention: tracks recently-applied remote changes by key + timestamp.
 *
 * @module param-sync
 */

var C = require('../shared/constants');

var MIXER_POLL_MS = C.PARAM_DEBOUNCE_MS * 2;   // ~60ms = 16Hz
var TRANSPORT_POLL_MS = 200;                     // 5Hz
var STRUCTURE_POLL_MS = 500;                     // 2Hz
var DEEP_POLL_MS = 250;                          // 4Hz
var ECHO_SUPPRESS_MS = 1000;
var CONFLICT_WINDOW_MS = 500;
var TRACKS_PER_SCAN = 2;                         // scan 2 tracks per structure cycle

var SYNCED_TRACK_PARAMS = ['volume', 'pan', 'mute', 'solo', 'arm', 'color', 'name'];

function ParamSync(abletonClient, engine, options) {
  options = options || {};
  this._client = abletonClient;
  this._writeClient = options.writeClient || abletonClient;
  this._engine = engine;
  this._userId = options.userId || 'local';

  // Timers
  this._mixerTimer = null;
  this._transportTimer = null;
  this._structureTimer = null;
  this._deepTimer = null;
  this._cleanupTimer = null;
  this._enabled = true;

  // Snapshots
  this._trackSnapshot = [];
  this._transportSnapshot = { tempo: 0, playing: false };
  this._deviceSnapshot = {};   // { 'T:D': { name, params: {idx: val} } }
  this._deviceListSnapshot = {}; // { trackIdx: [{name, class_name}] }
  this._clipSnapshot = {};     // { 'T:C': { has_clip, name, length, is_playing, color } }
  this._clipListSnapshot = {}; // { trackIdx: [{has_clip, name, ...}] }
  this._noteSnapshot = {};     // { 'T:C': noteHash }
  this._noteCache = {};        // { 'T:C': [notes] }
  this._autoSnapshot = {};     // { 'T:C:P': pointsHash }

  // Echo suppression
  this._recentRemoteApply = {};
  this._recentLocalChange = {};

  // Applying state
  this._applyingCount = 0;
  this._pollPausedUntil = 0;

  // Structure scan cursor (rotates through tracks)
  this._scanIndex = 0;
  this._trackCount = 0;

  // Focused track (from cursor sync) — deep polling targets this track
  this._focusedTrack = 0;
  this._focusedClip = -1;

  // Per-track sync toggles
  this._trackSyncConfig = {};

  // Sync layer toggles
  this._layerEnabled = {
    mixer: true,
    devices: true,
    clips: true,
    notes: true,
    automation: true
  };

  this._handlers = {};

  var self = this;
  this._engineStateHandler = function(data) { self._onPeerState(data); };
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

  var self = this;
  this._takeInitialSnapshot().then(function() {
    self._startPollers();
  }).catch(function() {
    self._startPollers();
  });
};

ParamSync.prototype._startPollers = function() {
  this._mixerTimer = setInterval(this._pollMixer.bind(this), MIXER_POLL_MS);
  this._transportTimer = setInterval(this._pollTransport.bind(this), TRANSPORT_POLL_MS);
  this._structureTimer = setInterval(this._pollStructure.bind(this), STRUCTURE_POLL_MS);
  this._deepTimer = setInterval(this._pollDeep.bind(this), DEEP_POLL_MS);
  this._cleanupTimer = setInterval(this._cleanupSuppression.bind(this), 5000);
};

ParamSync.prototype.stop = function() {
  var timers = ['_mixerTimer', '_transportTimer', '_structureTimer', '_deepTimer', '_cleanupTimer'];
  for (var i = 0; i < timers.length; i++) {
    if (this[timers[i]]) { clearInterval(this[timers[i]]); this[timers[i]] = null; }
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

    self._trackSnapshot = [];
    var trackArr = Array.isArray(tracks) ? tracks : (tracks && tracks.tracks ? tracks.tracks : []);
    for (var i = 0; i < trackArr.length; i++) {
      self._trackSnapshot.push(self._extractTrackParams(trackArr[i]));
    }
    self._trackCount = trackArr.length;

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
// Tier 1: Mixer polling (16Hz) — existing functionality
// ---------------------------------------------------------------------------

ParamSync.prototype._pollMixer = function() {
  if (!this._canPoll() || !this._layerEnabled.mixer) return;

  var self = this;
  this._client.getAllTracksInfo().then(function(result) {
    var tracks = Array.isArray(result) ? result : (result && result.tracks ? result.tracks : []);
    var now = Date.now();

    while (self._trackSnapshot.length < tracks.length) {
      self._trackSnapshot.push({ volume: 0.85, pan: 0, mute: false, solo: false, arm: false, color: -1, name: '' });
    }
    self._trackCount = tracks.length;

    for (var i = 0; i < tracks.length; i++) {
      var current = self._extractTrackParams(tracks[i]);
      var snapshot = self._trackSnapshot[i];
      if (!snapshot) continue;

      for (var p = 0; p < SYNCED_TRACK_PARAMS.length; p++) {
        var param = SYNCED_TRACK_PARAMS[p];
        if (current[param] === snapshot[param]) continue;

        var paramKey = i + ':' + param;
        if (self._isSuppressed(paramKey, now)) {
          snapshot[param] = current[param];
          continue;
        }

        var oldVal = snapshot[param];
        snapshot[param] = current[param];
        self._checkConflict(paramKey, 'local', now);
        self._recentLocalChange[paramKey] = now;
        self._engine.sendParam(i, param, current[param]);
        self._emit('local_change', {
          track: i, trackName: tracks[i].name || ('Track ' + (i + 1)),
          param: param, oldValue: oldVal, newValue: current[param], timestamp: now
        });
      }
    }
  }).catch(function() {});
};

// ---------------------------------------------------------------------------
// Tier 2: Structure polling (2Hz) — devices + clips, rotating through tracks
// ---------------------------------------------------------------------------

ParamSync.prototype._pollStructure = function() {
  if (!this._canPoll()) return;
  if (!this._layerEnabled.devices && !this._layerEnabled.clips) return;
  if (this._trackCount === 0) return;

  var self = this;
  var startIdx = this._scanIndex;

  for (var n = 0; n < TRACKS_PER_SCAN; n++) {
    var t = (startIdx + n) % this._trackCount;
    this._scanTrackStructure(t);
  }

  this._scanIndex = (startIdx + TRACKS_PER_SCAN) % this._trackCount;
};

/**
 * Scan a single track's devices + clip slots via get_track_info (one TCP call).
 */
ParamSync.prototype._scanTrackStructure = function(trackIdx) {
  var self = this;
  this._client.getTrackInfo(trackIdx).then(function(result) {
    var now = Date.now();

    // --- Devices ---
    if (self._layerEnabled.devices) {
      var devices = result.devices || [];
      var oldDevList = self._deviceListSnapshot[trackIdx] || [];
      var newDevList = [];

      for (var d = 0; d < devices.length; d++) {
        newDevList.push({ name: devices[d].name || '', class_name: devices[d].class_name || '' });
      }

      if (newDevList.length > oldDevList.length) {
        for (var a = oldDevList.length; a < newDevList.length; a++) {
          var addKey = 'dev:' + trackIdx + ':add:' + a;
          if (!self._isSuppressed(addKey, now)) {
            self._engine.sendSyncDelta('device_op', {
              op: 'add', track: trackIdx, device_index: a,
              device_name: newDevList[a].name, class_name: newDevList[a].class_name
            });
            self._emit('local_change', {
              track: trackIdx, param: 'device_add',
              oldValue: null, newValue: newDevList[a].name, timestamp: now
            });
          }
        }
      }

      if (newDevList.length < oldDevList.length) {
        for (var r = newDevList.length; r < oldDevList.length; r++) {
          var rmKey = 'dev:' + trackIdx + ':rm:' + r;
          if (!self._isSuppressed(rmKey, now)) {
            self._engine.sendSyncDelta('device_op', {
              op: 'remove', track: trackIdx, device_index: r,
              device_name: oldDevList[r].name
            });
            self._emit('local_change', {
              track: trackIdx, param: 'device_remove',
              oldValue: oldDevList[r].name, newValue: null, timestamp: now
            });
          }
        }
      }

      self._deviceListSnapshot[trackIdx] = newDevList;
    }

    // --- Clips ---
    if (self._layerEnabled.clips) {
      var slots = result.clip_slots || [];
      var oldClipList = self._clipListSnapshot[trackIdx] || [];

      for (var c = 0; c < slots.length; c++) {
        var slot = slots[c];
        var oldSlot = oldClipList[c] || {};
        var hasClip = !!slot.has_clip;
        var hadClip = !!oldSlot.has_clip;
        var clipInfo = slot.clip || {};
        var oldClipInfo = oldSlot.clip || {};
        var key = trackIdx + ':' + c;

        if (hasClip && !hadClip) {
          var createKey = 'clip:' + key + ':create';
          if (!self._isSuppressed(createKey, now)) {
            self._engine.sendSyncDelta('clip_op', {
              op: 'create', track: trackIdx, clip: c,
              name: clipInfo.name || '', length: clipInfo.length || 4
            });
            self._emit('local_change', {
              track: trackIdx, param: 'clip_create', oldValue: null,
              newValue: clipInfo.name || ('Clip ' + c), timestamp: now
            });
          }
        }

        if (!hasClip && hadClip) {
          var deleteKey = 'clip:' + key + ':delete';
          if (!self._isSuppressed(deleteKey, now)) {
            self._engine.sendSyncDelta('clip_op', {
              op: 'delete', track: trackIdx, clip: c
            });
            self._emit('local_change', {
              track: trackIdx, param: 'clip_delete',
              oldValue: oldClipInfo.name || ('Clip ' + c), newValue: null, timestamp: now
            });
          }
        }

        if (hasClip && hadClip && clipInfo.is_playing !== oldClipInfo.is_playing) {
          var stateKey = 'clip:' + key + ':state';
          if (!self._isSuppressed(stateKey, now)) {
            var op = clipInfo.is_playing ? 'fire' : 'stop';
            self._engine.sendSyncDelta('clip_op', {
              op: op, track: trackIdx, clip: c
            });
            self._emit('local_change', {
              track: trackIdx, param: 'clip_' + op,
              oldValue: !clipInfo.is_playing, newValue: clipInfo.is_playing, timestamp: now
            });
          }
        }
      }

      self._clipListSnapshot[trackIdx] = slots;
    }
  }).catch(function() {});
};

// ---------------------------------------------------------------------------
// Tier 3: Deep polling (4Hz) — device params + notes + automation on focused track
// ---------------------------------------------------------------------------

ParamSync.prototype._pollDeep = function() {
  if (!this._canPoll()) return;
  var t = this._focusedTrack;
  if (t < 0 || t >= this._trackCount) return;

  if (this._layerEnabled.devices) this._pollDeviceParams(t);
  if (this._layerEnabled.notes && this._focusedClip >= 0) this._pollClipNotes(t, this._focusedClip);
  if (this._layerEnabled.automation && this._focusedClip >= 0) this._pollClipAutomation(t, this._focusedClip);
};

ParamSync.prototype._pollDeviceParams = function(trackIdx) {
  var self = this;
  var deviceList = this._deviceListSnapshot[trackIdx];
  if (!deviceList || deviceList.length === 0) return;

  // Poll first 4 devices max (keep TCP load reasonable)
  var maxDevices = Math.min(deviceList.length, 4);
  for (var d = 0; d < maxDevices; d++) {
    (function(devIdx) {
      self._client.getDeviceParameters(trackIdx, devIdx).then(function(result) {
        var params = Array.isArray(result) ? result : (result && result.parameters ? result.parameters : []);
        var now = Date.now();
        var snapKey = trackIdx + ':' + devIdx;
        var oldParams = self._deviceSnapshot[snapKey] || {};
        var newParams = {};

        for (var p = 0; p < params.length; p++) {
          var param = params[p];
          var pName = param.name || ('P' + p);
          var val = param.value;
          newParams[pName] = val;

          if (oldParams[pName] !== undefined && oldParams[pName] !== val) {
            var paramKey = 'dp:' + trackIdx + ':' + devIdx + ':' + pName;
            if (!self._isSuppressed(paramKey, now)) {
              self._recentLocalChange[paramKey] = now;
              self._engine.sendSyncDelta('device_param', {
                track: trackIdx, device: devIdx,
                param_name: pName, value: val
              });
              self._emit('local_change', {
                track: trackIdx, param: 'device_param',
                oldValue: oldParams[pName], newValue: val,
                detail: pName, timestamp: now
              });
            }
          }
        }

        self._deviceSnapshot[snapKey] = newParams;
      }).catch(function() {});
    })(d);
  }
};

ParamSync.prototype._pollClipNotes = function(trackIdx, clipIdx) {
  var self = this;
  this._client.getClipNotes(trackIdx, clipIdx).then(function(result) {
    var notes = Array.isArray(result) ? result : (result && result.notes ? result.notes : []);
    var now = Date.now();
    var key = trackIdx + ':' + clipIdx;
    var hash = self._hashNotes(notes);

    if (self._noteSnapshot[key] && self._noteSnapshot[key] !== hash) {
      var suppressKey = 'notes:' + key;
      if (!self._isSuppressed(suppressKey, now)) {
        self._recentLocalChange[suppressKey] = now;
        self._engine.sendSyncDelta('clip_notes', {
          track: trackIdx, clip: clipIdx, notes: notes, hash: hash
        });
        self._emit('local_change', {
          track: trackIdx, param: 'clip_notes',
          oldValue: self._noteCache[key] ? self._noteCache[key].length + ' notes' : '?',
          newValue: notes.length + ' notes', timestamp: now
        });
      }
    }

    self._noteSnapshot[key] = hash;
    self._noteCache[key] = notes;
  }).catch(function() {});
};

ParamSync.prototype._pollClipAutomation = function(trackIdx, clipIdx) {
  // Automation polling is expensive — only poll if we have device params to check
  var deviceList = this._deviceListSnapshot[trackIdx];
  if (!deviceList || deviceList.length === 0) return;

  var self = this;
  // Poll automation for first device's first 4 param names
  var devIdx = 0;
  var snapKey = trackIdx + ':' + devIdx;
  var deviceParams = this._deviceSnapshot[snapKey];
  if (!deviceParams) return;

  var paramNames = Object.keys(deviceParams).slice(0, 4);
  for (var i = 0; i < paramNames.length; i++) {
    (function(paramName) {
      self._client.getClipAutomation(trackIdx, clipIdx, paramName).then(function(result) {
        if (!result || !result.has_automation) return;
        var points = result.points || [];
        if (points.length === 0) return;

        var now = Date.now();
        var key = trackIdx + ':' + clipIdx + ':' + paramName;
        var hash = self._hashPoints(points);

        if (self._autoSnapshot[key] && self._autoSnapshot[key] !== hash) {
          var suppressKey = 'auto:' + key;
          if (!self._isSuppressed(suppressKey, now)) {
            self._recentLocalChange[suppressKey] = now;
            self._engine.sendSyncDelta('automation', {
              track: trackIdx, clip: clipIdx, param_name: paramName, points: points
            });
            self._emit('local_change', {
              track: trackIdx, param: 'automation',
              oldValue: null, newValue: points.length + ' points', timestamp: now
            });
          }
        }

        self._autoSnapshot[key] = hash;
      }).catch(function() {});
    })(paramNames[i]);
  }
};

// ---------------------------------------------------------------------------
// Transport polling (5Hz) — unchanged
// ---------------------------------------------------------------------------

ParamSync.prototype._pollTransport = function() {
  if (!this._canPoll()) return;

  var self = this;
  this._client.getSessionInfo().then(function(session) {
    var now = Date.now();
    var tempo = session.tempo || 120;
    var playing = !!session.is_playing;

    if (Math.abs(tempo - self._transportSnapshot.tempo) > 0.01) {
      var tempoKey = 'transport:tempo';
      if (!self._isSuppressed(tempoKey, now)) {
        var oldTempo = self._transportSnapshot.tempo;
        self._transportSnapshot.tempo = tempo;
        self._engine.sendTransport(undefined, tempo);
        self._emit('local_change', { track: -1, param: 'tempo', oldValue: oldTempo, newValue: tempo, timestamp: now });
      } else {
        self._transportSnapshot.tempo = tempo;
      }
    }

    if (playing !== self._transportSnapshot.playing) {
      var playKey = 'transport:playing';
      if (!self._isSuppressed(playKey, now)) {
        self._transportSnapshot.playing = playing;
        self._engine.sendTransport(playing, undefined);
        self._emit('local_change', { track: -1, param: 'playing', oldValue: !playing, newValue: playing, timestamp: now });
      } else {
        self._transportSnapshot.playing = playing;
      }
    }
  }).catch(function() {});
};

// ---------------------------------------------------------------------------
// Incoming: apply peer deltas
// ---------------------------------------------------------------------------

ParamSync.prototype._onPeerState = function(data) {
  if (!this._enabled) return;

  var payload;
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    try { payload = JSON.parse(data.slice(5).toString('utf8')); } catch(e) { return; }
  } else if (typeof data === 'object') {
    payload = data;
  } else {
    return;
  }

  var now = Date.now();

  switch (payload.type) {
    case 'param':       this._applyRemoteParam(payload.track, payload.param, payload.value, now); break;
    case 'transport':   this._applyRemoteTransportPayload(payload, now); break;
    case 'device_param': this._applyRemoteDeviceParam(payload, now); break;
    case 'clip_notes':  this._applyRemoteClipNotes(payload, now); break;
    case 'clip_op':     this._applyRemoteClipOp(payload, now); break;
    case 'device_op':   this._applyRemoteDeviceOp(payload, now); break;
    case 'automation':  this._applyRemoteAutomation(payload, now); break;
  }
};

// --- Mixer param apply (existing) ---

ParamSync.prototype._applyRemoteParam = function(trackIdx, param, value, now) {
  console.log('[param-sync] APPLY REMOTE: track=' + trackIdx + ' param=' + param + ' value=' + value);

  var config = this._trackSyncConfig[trackIdx];
  if (config && config.mixer === false) return;

  var paramKey = trackIdx + ':' + param;
  this._recentRemoteApply[paramKey] = now + ECHO_SUPPRESS_MS;

  if (this._trackSnapshot[trackIdx]) {
    this._trackSnapshot[trackIdx][param] = value;
  }

  this._applyingCount++;
  this._pollPausedUntil = Date.now() + ECHO_SUPPRESS_MS;

  var self = this;
  var p;

  if (param === 'volume') { this._writeClient.setTrackVolumeUDP(trackIdx, value); p = Promise.resolve(); }
  else if (param === 'pan') { this._writeClient.setTrackPanUDP(trackIdx, value); p = Promise.resolve(); }
  else if (param === 'mute') { p = this._writeClient.setTrackMute(trackIdx, value); }
  else if (param === 'solo') { p = this._writeClient.setTrackSolo(trackIdx, value); }
  else if (param === 'arm') { p = this._writeClient.setTrackArm(trackIdx, value); }
  else if (param === 'color') { p = this._writeClient.send('set_track_color', { track_index: trackIdx, color_index: value }); }
  else if (param === 'name') { p = this._writeClient.send('set_track_name', { track_index: trackIdx, name: value }); }

  if (p) {
    p.then(function(r) {
      self._applyingCount = Math.max(0, self._applyingCount - 1);
      self._emit('remote_applied', { track: trackIdx, param: param, value: value, result: r });
    }).catch(function(err) {
      self._applyingCount = Math.max(0, self._applyingCount - 1);
      self._emit('remote_apply_error', { track: trackIdx, param: param, value: value, error: err.message || String(err) });
    });
  } else {
    self._applyingCount = Math.max(0, self._applyingCount - 1);
  }

  this._emit('remote_change', { track: trackIdx, param: param, value: value, timestamp: now });
};

// --- Transport apply ---

ParamSync.prototype._applyRemoteTransportPayload = function(payload, now) {
  if (payload.tempo !== undefined) {
    this._recentRemoteApply['transport:tempo'] = now + ECHO_SUPPRESS_MS;
    this._transportSnapshot.tempo = payload.tempo;
    this._writeClient.setTempo(payload.tempo).catch(function() {});
  }
  if (payload.playing !== undefined) {
    this._recentRemoteApply['transport:playing'] = now + ECHO_SUPPRESS_MS;
    this._transportSnapshot.playing = payload.playing;
    if (payload.playing) this._writeClient.startPlayback().catch(function() {});
    else this._writeClient.stopPlayback().catch(function() {});
  }
  this._emit('remote_change', { track: -1, param: 'transport', value: payload, timestamp: now });
};

// --- Device parameter apply ---

ParamSync.prototype._applyRemoteDeviceParam = function(payload, now) {
  var t = payload.track, d = payload.device, pName = payload.param_name, val = payload.value;
  console.log('[param-sync] APPLY DEVICE PARAM: T' + t + ':D' + d + ':' + pName + ' = ' + val);

  var paramKey = 'dp:' + t + ':' + d + ':' + pName;
  this._recentRemoteApply[paramKey] = now + ECHO_SUPPRESS_MS;

  // Update snapshot
  var snapKey = t + ':' + d;
  if (!this._deviceSnapshot[snapKey]) this._deviceSnapshot[snapKey] = {};
  this._deviceSnapshot[snapKey][pName] = val;

  // Apply via UDP for speed (uses parameter_name)
  this._writeClient.setDeviceParameterUDP(t, d, pName, val);
  this._emit('remote_applied', { track: t, param: 'device_param', value: val, detail: pName });
  this._emit('remote_change', { track: t, param: 'device_param', value: payload, timestamp: now });
};

// --- Clip notes apply ---

ParamSync.prototype._applyRemoteClipNotes = function(payload, now) {
  var t = payload.track, c = payload.clip;
  console.log('[param-sync] APPLY CLIP NOTES: T' + t + ':C' + c + ' (' + (payload.notes ? payload.notes.length : 0) + ' notes)');

  var suppressKey = 'notes:' + t + ':' + c;
  this._recentRemoteApply[suppressKey] = now + ECHO_SUPPRESS_MS;
  this._noteSnapshot[t + ':' + c] = payload.hash;
  this._noteCache[t + ':' + c] = payload.notes;

  this._applyingCount++;
  var self = this;

  // Clear existing notes, then add new ones
  this._writeClient.clearClipNotes(t, c).then(function() {
    if (payload.notes && payload.notes.length > 0) {
      return self._writeClient.addNotesToClip(t, c, payload.notes);
    }
  }).then(function() {
    self._applyingCount = Math.max(0, self._applyingCount - 1);
    self._emit('remote_applied', { track: t, param: 'clip_notes', value: (payload.notes || []).length + ' notes' });
  }).catch(function(err) {
    self._applyingCount = Math.max(0, self._applyingCount - 1);
    self._emit('remote_apply_error', { track: t, param: 'clip_notes', error: err.message || String(err) });
  });

  this._emit('remote_change', { track: t, param: 'clip_notes', value: payload, timestamp: now });
};

// --- Clip operation apply (create/delete/fire/stop) ---

ParamSync.prototype._applyRemoteClipOp = function(payload, now) {
  var t = payload.track, c = payload.clip, op = payload.op;
  console.log('[param-sync] APPLY CLIP OP: T' + t + ':C' + c + ' op=' + op);

  var suppressKey = 'clip:' + t + ':' + c + ':' + (op === 'fire' || op === 'stop' ? 'state' : op);
  this._recentRemoteApply[suppressKey] = now + ECHO_SUPPRESS_MS;

  var p;
  if (op === 'create') p = this._writeClient.createClip(t, c, payload.length || 4);
  else if (op === 'delete') p = this._writeClient.deleteClip(t, c);
  else if (op === 'fire') p = this._writeClient.fireClip(t, c);
  else if (op === 'stop') p = this._writeClient.stopClip(t, c);

  var self = this;
  if (p) {
    p.then(function() {
      self._emit('remote_applied', { track: t, param: 'clip_' + op, value: op });
    }).catch(function(err) {
      self._emit('remote_apply_error', { track: t, param: 'clip_' + op, error: err.message || String(err) });
    });
  }

  this._emit('remote_change', { track: t, param: 'clip_' + op, value: payload, timestamp: now });
};

// --- Device operation apply (add/remove) ---

ParamSync.prototype._applyRemoteDeviceOp = function(payload, now) {
  var t = payload.track, op = payload.op;
  console.log('[param-sync] APPLY DEVICE OP: T' + t + ' op=' + op + ' device=' + (payload.device_name || payload.device_index));

  var suppressKey = 'dev:' + t + ':' + (op === 'add' ? 'add' : 'rm') + ':' + payload.device_index;
  this._recentRemoteApply[suppressKey] = now + ECHO_SUPPRESS_MS;

  var p;
  if (op === 'add' && payload.device_name) {
    p = this._writeClient.insertDevice(t, payload.device_name);
  } else if (op === 'remove') {
    p = this._writeClient.deleteDevice(t, payload.device_index);
  }

  var self = this;
  if (p) {
    p.then(function() {
      self._emit('remote_applied', { track: t, param: 'device_' + op, value: payload.device_name || payload.device_index });
    }).catch(function(err) {
      self._emit('remote_apply_error', { track: t, param: 'device_' + op, error: err.message || String(err) });
    });
  }

  this._emit('remote_change', { track: t, param: 'device_' + op, value: payload, timestamp: now });
};

// --- Automation apply ---

ParamSync.prototype._applyRemoteAutomation = function(payload, now) {
  var t = payload.track, c = payload.clip, pName = payload.param_name;
  console.log('[param-sync] APPLY AUTOMATION: T' + t + ':C' + c + ':' + pName + ' (' + (payload.points ? payload.points.length : 0) + ' points)');

  var suppressKey = 'auto:' + t + ':' + c + ':' + pName;
  this._recentRemoteApply[suppressKey] = now + ECHO_SUPPRESS_MS;
  this._autoSnapshot[t + ':' + c + ':' + pName] = this._hashPoints(payload.points || []);

  var self = this;
  this._writeClient.createClipAutomation(t, c, pName, payload.points || []).then(function() {
    self._emit('remote_applied', { track: t, param: 'automation', value: (payload.points || []).length + ' points' });
  }).catch(function(err) {
    self._emit('remote_apply_error', { track: t, param: 'automation', error: err.message || String(err) });
  });

  this._emit('remote_change', { track: t, param: 'automation', value: payload, timestamp: now });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

ParamSync.prototype._canPoll = function() {
  if (!this._enabled || !this._client.isConnected()) return false;
  if (this._applyingCount > 0) return false;
  if (this._pollPausedUntil && Date.now() < this._pollPausedUntil) return false;
  return true;
};

ParamSync.prototype._isSuppressed = function(paramKey, now) {
  var until = this._recentRemoteApply[paramKey];
  return until && now < until;
};

ParamSync.prototype._hashNotes = function(notes) {
  // Simple hash: concatenate pitch+time+duration for each note
  var parts = [];
  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    parts.push((n.pitch || n.note || 0) + ':' + (n.time || n.start_time || 0) + ':' + (n.duration || 0));
  }
  parts.sort();
  return parts.join('|');
};

ParamSync.prototype._hashPoints = function(points) {
  var parts = [];
  for (var i = 0; i < points.length; i++) {
    parts.push((points[i].time || 0).toFixed(4) + ':' + (points[i].value || 0).toFixed(4));
  }
  return parts.join('|');
};

ParamSync.prototype._checkConflict = function(paramKey, source, now) {
  if (source === 'local') {
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

ParamSync.prototype._cleanupSuppression = function() {
  var now = Date.now();
  var keys = Object.keys(this._recentRemoteApply);
  for (var i = 0; i < keys.length; i++) {
    if (this._recentRemoteApply[keys[i]] < now) delete this._recentRemoteApply[keys[i]];
  }
  keys = Object.keys(this._recentLocalChange);
  for (var j = 0; j < keys.length; j++) {
    if ((now - this._recentLocalChange[keys[j]]) > CONFLICT_WINDOW_MS * 2) delete this._recentLocalChange[keys[j]];
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

ParamSync.prototype.setFocusedTrack = function(trackIdx) {
  this._focusedTrack = trackIdx;
};

ParamSync.prototype.setFocusedClip = function(clipIdx) {
  this._focusedClip = clipIdx;
};

ParamSync.prototype.setLayerEnabled = function(layer, enabled) {
  if (this._layerEnabled.hasOwnProperty(layer)) {
    this._layerEnabled[layer] = enabled;
  }
};

ParamSync.prototype.getLayerEnabled = function() {
  return JSON.parse(JSON.stringify(this._layerEnabled));
};

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
    transport: this._transportSnapshot,
    deviceList: this._deviceListSnapshot,
    clipList: this._clipListSnapshot,
    focusedTrack: this._focusedTrack,
    focusedClip: this._focusedClip,
    layers: this._layerEnabled
  };
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = ParamSync;
}

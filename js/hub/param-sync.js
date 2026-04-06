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
var ParamWizard = require('./param-wizard');

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
  this._clipClient = options.clipClient || options.writeClient || abletonClient;
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
  this._clipListSnapshot = {}; // { trackIdx: [{has_clip, name, ...}] } — structure scanner
  this._clipWatchSnapshot = {}; // { trackIdx: [{has_clip, ...}] } — dedicated clip watch
  this._noteSnapshot = {};     // { 'T:C': noteHash }
  this._noteCache = {};        // { 'T:C': [notes] }
  this._autoSnapshot = {};     // { 'T:C:P': pointsHash }

  // ======================================================================
  // ECHO GUARD — ABSOLUTE RULE: NO ECHO LOOPS EVER
  // When a remote delta is received and applied, the affected slot is
  // LOCKED for 5 seconds. During lock, NO outgoing deltas are sent
  // for that slot. This is checked by _isLocked() before ANY send.
  // The lock covers ALL operation types on that slot (create/delete/
  // fire/stop/notes/params). This is the ONLY echo prevention needed.
  // ======================================================================
  this._echoLock = {};        // { slotKey: unlockTimestamp }
  this._ECHO_LOCK_MS = 5000;  // 5 second hard lock after remote apply

  // Legacy suppression (mixer params — kept for backward compat)
  this._recentRemoteApply = {};
  this._recentLocalChange = {};

  // Applying state
  this._applyingCount = 0;
  this._mixerPausedUntil = 0;

  // Structure scan cursor (rotates through tracks)
  this._scanIndex = 0;
  this._trackCount = 0;
  this._structureWarmup = true;  // true until first full rotation completes

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

  // ParamWizard — high-perf device param polling daemon
  this._wizard = new ParamWizard(this);

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
  this._clipWatchTimer = setInterval(this._pollFocusedClips.bind(this), 200);
  this._extraTimer = setInterval(this._pollExtra.bind(this), 2000); // 0.5Hz master + crossfader
  this._cleanupTimer = setInterval(this._cleanupSuppression.bind(this), 5000);
  this._wizard.start();
};

ParamSync.prototype.stop = function() {
  this._wizard.stop();
  var timers = ['_mixerTimer', '_transportTimer', '_structureTimer', '_deepTimer', '_clipWatchTimer', '_extraTimer', '_cleanupTimer'];
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
  if (!this._canPollMixer() || !this._layerEnabled.mixer) return;

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

  var startIdx = this._scanIndex;

  // Always scan the focused track first (ensures immediate detection)
  var focused = this._focusedTrack;
  if (focused >= 0 && focused < this._trackCount) {
    this._scanTrackStructure(focused);
  }

  for (var n = 0; n < TRACKS_PER_SCAN; n++) {
    var t = (startIdx + n) % this._trackCount;
    if (t !== focused) this._scanTrackStructure(t);
  }

  var nextIdx = (startIdx + TRACKS_PER_SCAN) % this._trackCount;
  // End warmup when we've completed one full rotation
  if (this._structureWarmup && nextIdx < startIdx) {
    this._structureWarmup = false;
    console.log('[param-sync] Structure warmup complete — deltas now active');
  }
  this._scanIndex = nextIdx;
};

/**
 * Scan a single track's devices + clip slots via get_track_info (one TCP call).
 * During warmup (first full rotation), only populates snapshots — no deltas sent.
 */
ParamSync.prototype._scanTrackStructure = function(trackIdx) {
  var self = this;
  this._client.getTrackInfo(trackIdx).then(function(result) {
    var now = Date.now();
    var warmup = self._structureWarmup;

    // --- Devices ---
    if (self._layerEnabled.devices) {
      var devices = result.devices || [];
      var oldDevList = self._deviceListSnapshot[trackIdx];
      var newDevList = [];

      for (var d = 0; d < devices.length; d++) {
        newDevList.push({ name: devices[d].name || '', class_name: devices[d].class_name || '' });
      }

      // Only diff after warmup AND when we have a previous snapshot
      // ECHO GUARD: skip if device slot is locked
      if (!warmup && oldDevList && !self._isLocked(self._devSlotKey(trackIdx))) {
        var oldNames = self._deviceNames(oldDevList);
        var newNames = self._deviceNames(newDevList);

        if (oldNames !== newNames) {
          // Find genuinely new devices (names in new but not old)
          var oldNameSet = {};
          for (var oi = 0; oi < oldDevList.length; oi++) oldNameSet[oldDevList[oi].name] = true;
          for (var ni = 0; ni < newDevList.length; ni++) {
            if (!oldNameSet[newDevList[ni].name]) {
              var addKey = 'dev:' + trackIdx + ':add:' + newDevList[ni].name;
              if (!self._isSuppressed(addKey, now)) {
                self._engine.sendSyncDelta('device_op', {
                  op: 'add', track: trackIdx, device_index: ni,
                  device_name: newDevList[ni].name, class_name: newDevList[ni].class_name
                });
                self._emit('local_change', {
                  track: trackIdx, param: 'device_add',
                  oldValue: null, newValue: newDevList[ni].name, timestamp: now
                });
              }
            }
          }

          // Find removed devices (names in old but not new)
          var newNameSet = {};
          for (var nj = 0; nj < newDevList.length; nj++) newNameSet[newDevList[nj].name] = true;
          for (var oj = 0; oj < oldDevList.length; oj++) {
            if (!newNameSet[oldDevList[oj].name]) {
              var rmKey = 'dev:' + trackIdx + ':rm:' + oldDevList[oj].name;
              if (!self._isSuppressed(rmKey, now)) {
                self._engine.sendSyncDelta('device_op', {
                  op: 'remove', track: trackIdx, device_index: oj,
                  device_name: oldDevList[oj].name
                });
                self._emit('local_change', {
                  track: trackIdx, param: 'device_remove',
                  oldValue: oldDevList[oj].name, newValue: null, timestamp: now
                });
              }
            }
          }
        }
      }

      self._deviceListSnapshot[trackIdx] = newDevList;
    }

    // --- Clips ---
    if (self._layerEnabled.clips) {
      var slots = result.clip_slots || [];
      var oldClipList = self._clipListSnapshot[trackIdx];

      // Only diff after warmup AND when we have a previous snapshot
      if (!warmup && oldClipList) {
        for (var c = 0; c < slots.length; c++) {
          var slot = slots[c];
          var oldSlot = oldClipList[c] || {};
          var hasClip = !!slot.has_clip;
          var hadClip = !!oldSlot.has_clip;
          var clipInfo = slot.clip || {};
          var oldClipInfo = oldSlot.clip || {};
          var key = trackIdx + ':' + c;

          // ECHO GUARD: skip if this slot is locked
          if (self._isLocked(self._clipSlotKey(trackIdx, c))) {
            console.log('[echo-guard] Skipping outgoing clip delta T' + trackIdx + ':C' + c + ' — slot locked');
            continue;
          }

          if (hasClip && !hadClip) {
            self._fetchAndSendClipCreate(trackIdx, c, clipInfo);
          }

          if (!hasClip && hadClip) {
            self._engine.sendSyncDelta('clip_op', { op: 'delete', track: trackIdx, clip: c });
            self._emit('local_change', {
              track: trackIdx, param: 'clip_delete',
              oldValue: oldClipInfo.name || ('Clip ' + c), newValue: null, timestamp: now
            });
          }

          if (hasClip && hadClip && clipInfo.is_playing !== oldClipInfo.is_playing) {
            var op = clipInfo.is_playing ? 'fire' : 'stop';
            self._engine.sendSyncDelta('clip_op', { op: op, track: trackIdx, clip: c });
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
// Focused track clip watch (2Hz via writeClient — never blocks)
// ---------------------------------------------------------------------------

ParamSync.prototype._pollFocusedClips = function() {
  if (!this._enabled) return;
  if (!this._clipClient || !this._clipClient.isConnected()) return;
  if (!this._layerEnabled.clips) return;
  if (this._trackCount === 0) return;

  // Don't queue more calls if previous one is still in flight
  if (this._clipWatchBusy) return;

  if (!this._clipWatchIndex) this._clipWatchIndex = 0;

  // Poll ONE track per tick (prevents TCP queue buildup)
  var t = this._clipWatchIndex % this._trackCount;
  this._clipWatchIndex = (this._clipWatchIndex + 1) % this._trackCount;
  this._pollTrackClips(t);
};

ParamSync.prototype._pollTrackClips = function(t) {
  var self = this;
  this._clipWatchBusy = true;
  this._clipClient.send('get_track_info', { track_index: t }).then(function(result) {
    self._clipWatchBusy = false;
    var now = Date.now();
    var slots = result.clip_slots || [];
    var oldClipList = self._clipWatchSnapshot[t];
    if (!oldClipList) {
      // First scan of this track — just store snapshot
      self._clipWatchSnapshot[t] = slots;
      return;
    }

    for (var c = 0; c < slots.length; c++) {
      var slot = slots[c];
      var oldSlot = oldClipList[c] || {};
      var hasClip = !!slot.has_clip;
      var hadClip = !!oldSlot.has_clip;
      var clipInfo = slot.clip || {};
      var key = t + ':' + c;

      // ECHO GUARD: if this slot is locked (remote change recently applied), skip ALL checks
      var slotKey = self._clipSlotKey(t, c);
      if (self._isLocked(slotKey)) {
        console.log('[echo-guard] Skipping outgoing clip delta T' + t + ':C' + c + ' — slot locked');
        continue;
      }

      // New clip created
      if (hasClip && !hadClip) {
        console.log('[param-sync] CLIP WATCH: new clip T' + t + ':C' + c);
        self._fetchAndSendClipCreate(t, c, clipInfo);
      }

      // Clip deleted
      if (!hasClip && hadClip) {
        console.log('[param-sync] CLIP WATCH: deleted T' + t + ':C' + c);
        self._engine.sendSyncDelta('clip_op', { op: 'delete', track: t, clip: c });
        self._emit('local_change', { track: t, param: 'clip_delete', oldValue: 'clip', newValue: null, timestamp: now });
      }

      if (hasClip && hadClip) {
        var oldPlaying = (oldSlot.clip || {}).is_playing;
        var oldLength = (oldSlot.clip || {}).length;

        // Clip fire/stop
        if (clipInfo.is_playing !== oldPlaying) {
          var op = clipInfo.is_playing ? 'fire' : 'stop';
          self._engine.sendSyncDelta('clip_op', { op: op, track: t, clip: c });
          self._emit('local_change', { track: t, param: 'clip_' + op, oldValue: !clipInfo.is_playing, newValue: clipInfo.is_playing, timestamp: now });
        }

        // Clip replaced (different length = delete+create happened between scans)
        if (clipInfo.length !== oldLength && oldLength) {
          console.log('[param-sync] CLIP WATCH: clip replaced T' + t + ':C' + c + ' (len ' + oldLength + '→' + clipInfo.length + ')');
          self._fetchAndSendClipCreate(t, c, clipInfo);
        }
      }
    }

    self._clipWatchSnapshot[t] = slots;
  }).catch(function() { self._clipWatchBusy = false; });
};

// ---------------------------------------------------------------------------
// Clip create + notes bundling
// ---------------------------------------------------------------------------

/**
 * When a new clip is detected, send the create delta IMMEDIATELY (no async wait).
 * Notes will be synced by the note poll rotation within a few seconds.
 * This avoids TCP queue starvation that blocked the old async note fetch.
 */
ParamSync.prototype._fetchAndSendClipCreate = function(trackIdx, clipIdx, clipInfo) {
  var devices = this._deviceListSnapshot[trackIdx] || [];
  console.log('[param-sync] CLIP CREATE: T' + trackIdx + ':C' + clipIdx +
    ' len=' + (clipInfo.length || 4) + ' devices=' + devices.length);

  // Send via engine (for peers connected via UDP/TCP)
  this._engine.sendSyncDelta('clip_create_full', {
    track: trackIdx, clip: clipIdx,
    name: clipInfo.name || '', length: clipInfo.length || 4,
    notes: [],
    devices: devices
  });

  // ALSO push directly to HAVEN via HTTP (reliable, bypasses engine queue)
  var self = this;
  var peerIp = this._engine.peerIp;
  if (peerIp) {
    this._directClipPush(peerIp, trackIdx, clipIdx, clipInfo.length || 4);
  }

  var key = trackIdx + ':' + clipIdx;
  this._noteSnapshot[key] = '';
  this._noteCache[key] = [];

  this._emit('local_change', {
    track: trackIdx, param: 'clip_create',
    oldValue: null, newValue: clipInfo.name || ('Clip ' + clipIdx),
    timestamp: Date.now()
  });
};

/**
 * Direct HTTP push to peer's /api/ableton/command — guaranteed delivery.
 * Creates the clip, then fetches local notes and pushes them.
 */
ParamSync.prototype._directClipPush = function(peerIp, trackIdx, clipIdx, length) {
  var http = require('http');
  var self = this;

  function peerCmd(type, params) {
    return new Promise(function(resolve, reject) {
      var body = JSON.stringify({ type: type, params: params });
      var req = http.request({
        hostname: peerIp, port: 3030, path: '/api/ableton/command',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, function(res) {
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { resolve({}); }
        });
      });
      req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
      req.setTimeout(10000, function() { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.write(body);
      req.end();
    });
  }

  // Step 1: Create clip on peer (ignore if exists)
  peerCmd('create_clip', { track_index: trackIdx, clip_index: clipIdx, length: length }).then(function() {
    // Step 2: Read notes from LOCAL Ableton via writeClient
    return self._writeClient.send('get_clip_notes', {
      track_index: trackIdx, clip_index: clipIdx,
      start_time: 0, time_span: 0, start_pitch: 0, pitch_span: 128
    });
  }).then(function(result) {
    var notes = (result && result.notes) ? result.notes : [];
    if (notes.length > 0) {
      // Step 3: Clear + add notes on peer
      return peerCmd('clear_clip_notes', { track_index: trackIdx, clip_index: clipIdx }).then(function() {
        return peerCmd('add_notes_to_clip', { track_index: trackIdx, clip_index: clipIdx, notes: notes });
      }).then(function() {
        console.log('[param-sync] DIRECT PUSH OK: T' + trackIdx + ':C' + clipIdx + ' → ' + notes.length + ' notes');
      });
    } else {
      console.log('[param-sync] DIRECT PUSH OK: T' + trackIdx + ':C' + clipIdx + ' (empty clip)');
    }
  }).catch(function(err) {
    console.log('[param-sync] DIRECT PUSH FAILED: T' + trackIdx + ':C' + clipIdx + ' — ' + (err.message || err));
  });
};

// ---------------------------------------------------------------------------
// Tier 3: Deep polling (4Hz) — device params on focused track + notes on ALL clips
// ---------------------------------------------------------------------------

ParamSync.prototype._pollDeep = function() {
  if (!this._canPoll()) return;

  // Device params handled by ParamWizard daemon (separate timer)

  // Note polling: rotate through ALL tracks that have clips
  if (this._layerEnabled.notes) this._pollNotesRotation();

  // Automation on focused clip only
  var t = this._focusedTrack;
  if (this._layerEnabled.automation && t >= 0 && t < this._trackCount && this._focusedClip >= 0) {
    this._pollClipAutomation(t, this._focusedClip);
  }
};

/**
 * Sweep ALL tracks with devices — per-track throttle (300ms min),
 * echo guard, batch delta collection. 1 track per cycle at 4Hz.
 */
ParamSync.prototype._pollDeviceParamsRotation = function() {
  var trackKeys = Object.keys(this._deviceListSnapshot);
  if (trackKeys.length === 0) return;
  if (!this._devParamScanIndex) this._devParamScanIndex = 0;
  if (!this._lastDevPoll) this._lastDevPoll = {};

  var idx = this._devParamScanIndex % trackKeys.length;
  this._devParamScanIndex = (this._devParamScanIndex + 1) % trackKeys.length;
  var trackIdx = Number(trackKeys[idx]);
  var now = Date.now();

  // Per-track throttle: min 300ms between polls of same track
  if (this._lastDevPoll[trackIdx] && (now - this._lastDevPoll[trackIdx]) < 300) return;

  // ECHO GUARD: skip locked tracks
  if (this._isLocked(this._devSlotKey(trackIdx))) return;

  this._lastDevPoll[trackIdx] = now;
  this._pollDeviceParams(trackIdx);
};

/**
 * Rotate through tracks polling notes on any clip that exists.
 * Polls 1 track per cycle at 4Hz → full rotation every ~8s for 33 tracks.
 */
ParamSync.prototype._pollNotesRotation = function() {
  if (this._trackCount === 0) return;
  if (!this._noteScanIndex) this._noteScanIndex = 0;

  var trackIdx = this._noteScanIndex % this._trackCount;
  this._noteScanIndex = (this._noteScanIndex + 1) % this._trackCount;

  // ECHO GUARD: skip locked clips
  var clips = this._clipListSnapshot[trackIdx];
  if (!clips) return;

  for (var c = 0; c < clips.length; c++) {
    if (clips[c] && clips[c].has_clip && !this._isLocked(this._clipSlotKey(trackIdx, c))) {
      this._pollClipNotes(trackIdx, c);
      return;
    }
  }
};

/**
 * Poll device params for one track via _clipClient (async TCP).
 * Collects diffs into a batch, sends all at once.
 */
ParamSync.prototype._pollDeviceParams = function(trackIdx) {
  var self = this;
  var deviceList = this._deviceListSnapshot[trackIdx];
  if (!deviceList || deviceList.length === 0) return;

  var maxDevices = Math.min(deviceList.length, 4);
  for (var d = 0; d < maxDevices; d++) {
    (function(devIdx) {
      self._clipClient.getDeviceParameters(trackIdx, devIdx).then(function(result) {
        var params = Array.isArray(result) ? result : (result && result.parameters ? result.parameters : []);
        var now = Date.now();
        var snapKey = trackIdx + ':' + devIdx;
        var oldParams = self._deviceSnapshot[snapKey] || {};
        var newParams = {};
        var batch = [];

        for (var p = 0; p < params.length; p++) {
          var param = params[p];
          var pName = param.name || ('P' + p);
          var val = param.value;
          newParams[pName] = val;

          if (oldParams[pName] !== undefined && oldParams[pName] !== val) {
            batch.push({ param_name: pName, value: val, oldValue: oldParams[pName] });
          }
        }

        // Batch send all changed params
        if (batch.length > 0 && !self._isLocked(self._devSlotKey(trackIdx))) {
          for (var b = 0; b < batch.length; b++) {
            self._engine.sendSyncDelta('device_param', {
              track: trackIdx, device: devIdx,
              param_name: batch[b].param_name, value: batch[b].value
            });
          }
          self._emit('local_change', {
            track: trackIdx, param: 'device_params_batch',
            oldValue: null, newValue: batch.length + ' params changed',
            timestamp: now
          });
        }

        self._deviceSnapshot[snapKey] = newParams;
      }).catch(function() {});
    })(d);
  }
};

ParamSync.prototype._pollClipNotes = function(trackIdx, clipIdx) {
  var self = this;
  // Use _writeClient to avoid saturating _client's poll queue
  // Use _writeClient for note reads — _clipClient is saturated by clip watch
  this._writeClient.send('get_clip_notes', {
    track_index: trackIdx, clip_index: clipIdx,
    start_time: 0, time_span: 0, start_pitch: 0, pitch_span: 128
  }).then(function(result) {
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
  if (!this._canPollMixer()) return;

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
    case 'clip_create_full': this._applyRemoteClipCreateFull(payload, now); break;
    case 'clip_op':     this._applyRemoteClipOp(payload, now); break;
    case 'device_op':   this._applyRemoteDeviceOp(payload, now); break;
    case 'automation':  this._applyRemoteAutomation(payload, now); break;
    case 'als_diff_apply': this._applyAlsDiff(payload, now); break;
    case 'master_param': this._applyMasterParam(payload, now); break;
    case 'master_device_param': this._applyMasterDeviceParam(payload, now); break;
    case 'crossfader': this._applyCrossfader(payload, now); break;
    case 'scene_prop': this._applySceneProp(payload, now); break;
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
  this._mixerPausedUntil = Date.now() + ECHO_SUPPRESS_MS;

  var self = this;
  var p;

  if (param === 'volume') { p = this._writeClient.setTrackVolume(trackIdx, value); }
  else if (param === 'pan') { p = this._writeClient.setTrackPan(trackIdx, value); }
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

  // ECHO GUARD: lock device slot
  this._lockSlot(this._devSlotKey(t));

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

  // ECHO GUARD: hard lock this clip slot
  this._lockSlot(this._clipSlotKey(t, c));

  // Also update clipWatchSnapshot so the watch doesn't re-detect this change
  if (this._clipWatchSnapshot[t]) {
    var snapSlot = this._clipWatchSnapshot[t][c];
    if (snapSlot) {
      if (op === 'delete') { snapSlot.has_clip = false; snapSlot.clip = null; }
      if (op === 'create') { snapSlot.has_clip = true; snapSlot.clip = { name: payload.name || '', length: payload.length || 4 }; }
    }
  }

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

// --- Full clip create apply (create + notes + instrument) ---

ParamSync.prototype._applyRemoteClipCreateFull = function(payload, now) {
  var t = payload.track, c = payload.clip;
  var notes = payload.notes || [];
  var devices = payload.devices || [];
  console.log('[param-sync] APPLY CLIP CREATE FULL: T' + t + ':C' + c +
    ' len=' + (payload.length || 4) + ' notes=' + notes.length + ' devices=' + devices.length);

  // ECHO GUARD: hard lock this clip slot
  this._lockSlot(this._clipSlotKey(t, c));

  var self = this;
  this._applyingCount++;

  // Step 1: Check if we need to load the same instrument
  var instrumentPromise = Promise.resolve();
  if (devices.length > 0) {
    var localDevices = this._deviceListSnapshot[t] || [];
    var localNames = {};
    for (var i = 0; i < localDevices.length; i++) localNames[localDevices[i].name] = true;
    // Find first device from peer that we don't have (likely the instrument)
    for (var d = 0; d < devices.length; d++) {
      if (!localNames[devices[d].name] && devices[d].class_name) {
        // Try to load this instrument by searching browser
        (function(devName) {
          instrumentPromise = self._writeClient.send('search_browser', {
            query: devName, category: 'instruments'
          }).then(function(searchResult) {
            var results = searchResult.results || [];
            if (results.length > 0 && results[0].uri) {
              return self._writeClient.send('load_instrument_or_effect', {
                track_index: t, uri: results[0].uri
              });
            }
          }).catch(function(err) {
            console.log('[param-sync] Instrument load failed for "' + devName + '": ' + (err.message || err));
          });
        })(devices[d].name);
        break; // only load one instrument
      }
    }
  }

  // Step 2: Create clip (ignore error if it already exists)
  instrumentPromise.then(function() {
    return self._writeClient.createClip(t, c, payload.length || 4).catch(function(e) {
      console.log('[param-sync] Clip T' + t + ':C' + c + ' already exists (ok): ' + e.message);
    });
  }).then(function() {
    // Step 3: Clear existing notes, then add new ones
    if (notes.length > 0) {
      return self._writeClient.clearClipNotes(t, c).catch(function() {}).then(function() {
        return self._writeClient.addNotesToClip(t, c, notes);
      });
    }
  }).then(function() {
    self._applyingCount = Math.max(0, self._applyingCount - 1);
    // Update snapshot
    if (notes.length > 0) {
      var key = t + ':' + c;
      self._noteSnapshot[key] = self._hashNotes(notes);
      self._noteCache[key] = notes;
    }
    self._emit('remote_applied', {
      track: t, param: 'clip_create_full',
      value: 'clip + ' + notes.length + ' notes'
    });
  }).catch(function(err) {
    self._applyingCount = Math.max(0, self._applyingCount - 1);
    self._emit('remote_apply_error', {
      track: t, param: 'clip_create_full',
      error: err.message || String(err)
    });
  });

  this._emit('remote_change', { track: t, param: 'clip_create_full', value: payload, timestamp: now });
};

// --- Device operation apply (add/remove) ---

ParamSync.prototype._applyRemoteDeviceOp = function(payload, now) {
  var t = payload.track, op = payload.op;
  var devName = payload.device_name || '';
  console.log('[param-sync] APPLY DEVICE OP: T' + t + ' op=' + op + ' device=' + devName);

  // ECHO GUARD: lock device slot
  this._lockSlot(this._devSlotKey(t));

  // Check if device already exists on this track before trying to insert
  if (op === 'add' && devName) {
    var existing = this._deviceListSnapshot[t] || [];
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].name === devName) {
        console.log('[param-sync] SKIP device add — "' + devName + '" already exists on T' + t);
        return;
      }
    }
  }

  var p;
  if (op === 'add' && devName) {
    p = this._writeClient.insertDevice(t, devName);
  } else if (op === 'remove') {
    p = this._writeClient.deleteDevice(t, payload.device_index);
  }

  var self = this;
  if (p) {
    p.then(function() {
      self._emit('remote_applied', { track: t, param: 'device_' + op, value: devName || payload.device_index });
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
// --- Master track + crossfader apply ---

ParamSync.prototype._applyMasterParam = function(payload, now) {
  var param = payload.param, val = payload.value;
  console.log('[param-sync] APPLY MASTER: ' + param + ' = ' + val);
  if (!this._masterSnapshot) this._masterSnapshot = {};
  this._masterSnapshot[param] = val;
  if (param === 'volume') this._writeClient.send('set_master_volume', { volume: val }).catch(function(){});
  if (param === 'pan') this._writeClient.send('set_master_pan', { pan: val }).catch(function(){});
  this._emit('remote_change', { track: -2, param: 'master_' + param, value: val, timestamp: now });
};

ParamSync.prototype._applyMasterDeviceParam = function(payload, now) {
  var d = payload.device, pName = payload.param_name, val = payload.value;
  this._writeClient.send('set_device_parameter', {
    track_index: 0, device_index: d, parameter_name: pName, value: val, track_type: 'master'
  }).catch(function(){});
  this._emit('remote_change', { track: -2, param: 'master_device_param', value: payload, timestamp: now });
};

ParamSync.prototype._applySceneProp = function(payload, now) {
  var scene = payload.scene, prop = payload.prop, val = payload.value;
  if (prop === 'name') this._writeClient.send('set_scene_name', { scene_index: scene, name: val }).catch(function(){});
  if (prop === 'color') this._writeClient.send('set_scene_color', { scene_index: scene, color_index: val }).catch(function(){});
  this._emit('remote_change', { track: -1, param: 'scene_' + prop, value: payload, timestamp: now });
};

ParamSync.prototype._applyCrossfader = function(payload, now) {
  console.log('[param-sync] APPLY CROSSFADER: ' + payload.value);
  this._crossfaderSnapshot = payload.value;
  this._writeClient.send('set_crossfader', { crossfader: payload.value }).catch(function(){});
  this._emit('remote_change', { track: -1, param: 'crossfader', value: payload.value, timestamp: now });
};

// ---------------------------------------------------------------------------
// Extra polling (0.5Hz) — master track, crossfader, scenes
// ---------------------------------------------------------------------------

ParamSync.prototype._pollExtra = function() {
  if (!this._canPoll()) return;
  if (!this._extraBusy) this._pollMasterTrack();
  if (!this._extraBusy2) this._pollCrossfader();
  if (!this._extraBusy3) this._pollScenes();
};

ParamSync.prototype._pollMasterTrack = function() {
  var self = this;
  this._extraBusy = true;
  this._clipClient.send('get_master_track_info', {}).then(function(result) {
    self._extraBusy = false;
    if (!result || !result.volume) return;
    var now = Date.now();

    if (!self._masterSnapshot) self._masterSnapshot = {};
    var snap = self._masterSnapshot;
    var params = { volume: result.volume, pan: result.panning || 0 };

    for (var key in params) {
      if (snap[key] !== undefined && snap[key] !== params[key]) {
        self._engine.sendSyncDelta('master_param', { param: key, value: params[key] });
        self._emit('local_change', { track: -2, param: 'master_' + key, oldValue: snap[key], newValue: params[key], timestamp: now });
      }
      snap[key] = params[key];
    }

    // Also poll master device params (rotate 1 device per cycle)
    var masterDevs = result.devices || [];
    if (masterDevs.length > 0) {
      if (!self._masterDevIdx) self._masterDevIdx = 0;
      var dIdx = self._masterDevIdx % masterDevs.length;
      self._masterDevIdx = (self._masterDevIdx + 1) % masterDevs.length;
      self._pollMasterDeviceParams(dIdx);
    }
  }).catch(function() { self._extraBusy = false; });
};

ParamSync.prototype._pollMasterDeviceParams = function(devIdx) {
  var self = this;
  this._clipClient.send('get_device_parameters', { track_index: 0, device_index: devIdx, track_type: 'master' }).then(function(result) {
    var params = result.parameters || result || [];
    if (!Array.isArray(params) || params.length === 0) return;
    var now = Date.now();
    var snapKey = 'master:' + devIdx;
    if (!self._deviceSnapshot[snapKey]) self._deviceSnapshot[snapKey] = {};
    var snap = self._deviceSnapshot[snapKey];
    var batch = [];

    for (var p = 0; p < params.length; p++) {
      var pName = params[p].name || ('P' + p);
      var val = params[p].value;
      if (snap[pName] !== undefined && snap[pName] !== val) {
        batch.push({ param_name: pName, value: val });
      }
      snap[pName] = val;
    }

    if (batch.length > 0) {
      for (var b = 0; b < batch.length; b++) {
        self._engine.sendSyncDelta('master_device_param', {
          device: devIdx, param_name: batch[b].param_name, value: batch[b].value
        });
      }
      self._emit('local_change', { track: -2, param: 'master_device', oldValue: null, newValue: batch.length + ' params', timestamp: now });
    }
  }).catch(function() {});
};

ParamSync.prototype._pollCrossfader = function() {
  var self = this;
  this._extraBusy2 = true;
  this._clipClient.send('get_crossfader', {}).then(function(result) {
    self._extraBusy2 = false;
    if (!result || result.crossfader === undefined) return;
    var now = Date.now();
    var val = result.crossfader;

    if (self._crossfaderSnapshot !== undefined && self._crossfaderSnapshot !== val) {
      self._engine.sendSyncDelta('crossfader', { value: val });
      self._emit('local_change', { track: -1, param: 'crossfader', oldValue: self._crossfaderSnapshot, newValue: val, timestamp: now });
    }
    self._crossfaderSnapshot = val;
  }).catch(function() { self._extraBusy2 = false; });
};

ParamSync.prototype._pollScenes = function() {
  var self = this;
  this._extraBusy3 = true;
  this._clipClient.send('get_scenes', {}).then(function(result) {
    self._extraBusy3 = false;
    var scenes = (result && result.scenes) ? result.scenes : [];
    if (scenes.length === 0) return;
    var now = Date.now();

    if (!self._sceneSnapshot) self._sceneSnapshot = [];

    // Detect scene count change
    if (self._sceneSnapshot.length > 0 && scenes.length !== self._sceneSnapshot.length) {
      self._engine.sendSyncDelta('scene_count', { count: scenes.length });
      self._emit('local_change', { track: -1, param: 'scene_count', oldValue: self._sceneSnapshot.length, newValue: scenes.length, timestamp: now });
    }

    // Detect scene name/color changes
    for (var i = 0; i < scenes.length; i++) {
      var old = self._sceneSnapshot[i] || {};
      if (old.name !== undefined && old.name !== scenes[i].name) {
        self._engine.sendSyncDelta('scene_prop', { scene: i, prop: 'name', value: scenes[i].name });
      }
      if (old.color_index !== undefined && old.color_index !== scenes[i].color_index) {
        self._engine.sendSyncDelta('scene_prop', { scene: i, prop: 'color', value: scenes[i].color_index });
      }
    }

    self._sceneSnapshot = scenes;
  }).catch(function() { self._extraBusy3 = false; });
};

// ---------------------------------------------------------------------------
// ALS Diff Apply — process structured diffs from .als file saves
// ---------------------------------------------------------------------------

ParamSync.prototype._applyAlsDiff = function(payload, now) {
  var changes = payload.changes || [];
  if (changes.length === 0) return;

  console.log('[param-sync] ALS DIFF: ' + changes.length + ' changes — ' + (payload.summary || ''));

  var noteChanges = [];
  var sampleChanges = [];

  for (var i = 0; i < changes.length; i++) {
    var cat = changes[i].category || '';
    if (cat === 'note_added' || cat === 'note_removed' || cat === 'note_modified') {
      noteChanges.push(changes[i]);
    } else if (cat === 'sample') {
      sampleChanges.push(changes[i]);
    }
  }

  // Re-sync affected clips by reading notes from local and pushing to peer
  if (noteChanges.length > 0) {
    var clipMap = {};
    for (var n = 0; n < noteChanges.length; n++) {
      var match = (noteChanges[n].path || '').match(/Tracks\/(\d+)\/Clips?\/(\d+)/i);
      if (match) {
        var key = match[1] + ':' + match[2];
        clipMap[key] = { track: parseInt(match[1]), clip: parseInt(match[2]) };
      }
    }
    var peerIp = this._engine.peerIp;
    var keys = Object.keys(clipMap);
    for (var k = 0; k < keys.length; k++) {
      var info = clipMap[keys[k]];
      console.log('[param-sync] ALS DIFF: pushing notes T' + info.track + ':C' + info.clip);
      if (peerIp) this._directClipPush(peerIp, info.track, info.clip, 4);
    }
  }

  // Log sample changes for awareness
  for (var s = 0; s < sampleChanges.length; s++) {
    console.log('[param-sync] SAMPLE CHANGED: ' + sampleChanges[s].path + ' → ' + (sampleChanges[s].to || sampleChanges[s].summary));
  }

  this._emit('remote_change', {
    track: -1, param: 'als_diff',
    value: { total: changes.length, notes: noteChanges.length, samples: sampleChanges.length },
    timestamp: now
  });
};

// Helpers
// ---------------------------------------------------------------------------

// ======================================================================
// ECHO GUARD — hard lock/check
// ======================================================================

/** Lock a slot after applying a remote change. NO outgoing deltas for this slot. */
ParamSync.prototype._lockSlot = function(slotKey) {
  this._echoLock[slotKey] = Date.now() + this._ECHO_LOCK_MS;
};

/** Check if a slot is locked (remote change was recently applied). */
ParamSync.prototype._isLocked = function(slotKey) {
  var until = this._echoLock[slotKey];
  return until && Date.now() < until;
};

/** Build slot key for a clip: "clip:T:C" */
ParamSync.prototype._clipSlotKey = function(trackIdx, clipIdx) {
  return 'clip:' + trackIdx + ':' + clipIdx;
};

/** Build slot key for a device: "dev:T" */
ParamSync.prototype._devSlotKey = function(trackIdx) {
  return 'dev:' + trackIdx;
};

/** Build a fingerprint string of device names for quick comparison */
ParamSync.prototype._deviceNames = function(devList) {
  var names = [];
  for (var i = 0; i < devList.length; i++) names.push(devList[i].name);
  return names.join('|');
};

ParamSync.prototype._canPoll = function() {
  if (!this._enabled || !this._client.isConnected()) return false;
  return true;
};

ParamSync.prototype._canPollMixer = function() {
  if (!this._canPoll()) return false;
  if (this._applyingCount > 0) return false;
  if (this._mixerPausedUntil && Date.now() < this._mixerPausedUntil) return false;
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
  // Clean expired echo locks
  keys = Object.keys(this._echoLock);
  for (var k = 0; k < keys.length; k++) {
    if (this._echoLock[keys[k]] < now) delete this._echoLock[keys[k]];
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

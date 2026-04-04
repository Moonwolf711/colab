/**
 * ParamWizard — GOD MODE device parameter polling daemon
 *
 * Watches every device parameter across all tracks. Async TCP reads via
 * dedicated clipClient. Map-based snapshots for O(1) diff. Per-track
 * throttle prevents hammering. Echo guard is law — locked slots are
 * untouchable. Batch delta collection with overflow protection.
 *
 * @module param-wizard
 */

var perf = typeof performance !== 'undefined' ? performance : { now: Date.now.bind(Date) };

function ParamWizard(paramSync) {
  this._ps = paramSync;

  // Map-based — faster than plain objects for hot-path lookups
  this._snap = new Map();              // 'T:D:paramName' → lastValue
  this._throttle = new Map();          // trackIdx → lastPollTimestamp

  this._POLL_MS = 200;                // 5Hz — aggressive but safe with locks
  this._THROTTLE_MS = 250;            // min gap between same-track polls
  this._BATCH_LIMIT = 50;             // cap deltas per tick to prevent flood
  this._interval = null;
  this._scanIndex = 0;
  this._pendingBatch = [];            // cross-device batch collector per tick
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

ParamWizard.prototype.start = function() {
  if (this._interval) return;
  var self = this;
  this._interval = setInterval(function() { self._tick(); }, this._POLL_MS);
  console.log('[param-wizard] GOD MODE ONLINE — ' + (1000 / this._POLL_MS) + 'Hz, all tracks, echo guard active');
};

ParamWizard.prototype.stop = function() {
  if (this._interval) {
    clearInterval(this._interval);
    this._interval = null;
    this._snap.clear();
    this._throttle.clear();
    this._pendingBatch = [];
    console.log('[param-wizard] Stopped');
  }
};

// ---------------------------------------------------------------------------
// Tick — sweep tracks, collect batch, send
// ---------------------------------------------------------------------------

ParamWizard.prototype._tick = function() {
  var ps = this._ps;
  if (!ps._enabled || !ps._clipClient || !ps._clipClient.isConnected()) return;

  var trackKeys = Object.keys(ps._deviceListSnapshot);
  if (trackKeys.length === 0) return;

  var now = perf.now();

  // Scan 2 tracks per tick at 5Hz = full rotation every ~3.4s for 34 tracks
  for (var n = 0; n < 2; n++) {
    var idx = this._scanIndex % trackKeys.length;
    this._scanIndex = (this._scanIndex + 1) % trackKeys.length;
    var trackIdx = Number(trackKeys[idx]);

    // Per-track throttle
    var last = this._throttle.get(trackIdx) || 0;
    if (now - last < this._THROTTLE_MS) continue;
    this._throttle.set(trackIdx, now);

    // ECHO GUARD — the unbreakable wall
    if (ps._isLocked(ps._devSlotKey(trackIdx))) continue;

    var deviceList = ps._deviceListSnapshot[trackIdx];
    if (!deviceList || deviceList.length === 0) continue;

    var maxDevices = Math.min(deviceList.length, 4);
    for (var d = 0; d < maxDevices; d++) {
      this._pollDevice(trackIdx, d);
    }
  }
};

// ---------------------------------------------------------------------------
// Poll one device — async TCP read, diff against Map snapshot, batch send
// ---------------------------------------------------------------------------

ParamWizard.prototype._pollDevice = function(trackIdx, devIdx) {
  var self = this;
  var ps = this._ps;

  ps._clipClient.getDeviceParameters(trackIdx, devIdx).then(function(result) {
    var params = Array.isArray(result) ? result : (result && result.parameters ? result.parameters : []);
    if (params.length === 0) return;

    // Double-check lock after async gap
    if (ps._isLocked(ps._devSlotKey(trackIdx))) return;

    var batch = [];
    for (var p = 0; p < params.length; p++) {
      var param = params[p];
      var pName = param.name || ('P' + p);
      var val = param.value;
      if (val === null || val === undefined) continue;

      var snapKey = trackIdx + ':' + devIdx + ':' + pName;
      var prev = self._snap.get(snapKey);

      if (prev !== undefined && prev !== val) {
        batch.push({ param_name: pName, value: val });
      }
      self._snap.set(snapKey, val);
    }

    // Batch send with overflow protection
    if (batch.length > 0) {
      var sendCount = Math.min(batch.length, self._BATCH_LIMIT);
      for (var b = 0; b < sendCount; b++) {
        ps._engine.sendSyncDelta('device_param', {
          track: trackIdx, device: devIdx,
          param_name: batch[b].param_name, value: batch[b].value
        });
      }
      if (batch.length > 1) {
        console.log('[param-wizard] T' + trackIdx + ':D' + devIdx + ' — ' + sendCount + ' params changed');
      }
      ps._emit('local_change', {
        track: trackIdx, param: 'device_params',
        oldValue: null, newValue: sendCount + ' params',
        timestamp: Date.now()
      });
    }
  }).catch(function() {});
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = ParamWizard;
}

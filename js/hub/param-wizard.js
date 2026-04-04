/**
 * ParamWizard — high-performance device parameter polling daemon
 * Map-based snapshots, per-track throttle, echo guard, batch deltas.
 * Reads via dedicated clipClient TCP connection (async, never blocks).
 *
 * @module param-wizard
 */

var perf = typeof performance !== 'undefined' ? performance : { now: Date.now.bind(Date) };

function ParamWizard(paramSync) {
  this._ps = paramSync;           // parent ParamSync (for engine, snapshots, locks)
  this._snap = {};                 // { 'T:D:paramName': lastValue }
  this._throttle = {};             // { trackIdx: lastPollTimestamp }
  this._POLL_MS = 250;            // 250ms = 4Hz per track
  this._THROTTLE_MS = 300;        // min gap between same-track polls
  this._interval = null;
  this._scanIndex = 0;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

ParamWizard.prototype.start = function() {
  if (this._interval) return;
  var self = this;
  this._interval = setInterval(function() { self._tick(); }, this._POLL_MS);
  console.log('[param-wizard] Online — polling all device params at ' + (1000 / this._POLL_MS) + 'Hz');
};

ParamWizard.prototype.stop = function() {
  if (this._interval) {
    clearInterval(this._interval);
    this._interval = null;
    console.log('[param-wizard] Stopped');
  }
};

// ---------------------------------------------------------------------------
// Tick — sweep one track per cycle
// ---------------------------------------------------------------------------

ParamWizard.prototype._tick = function() {
  var ps = this._ps;
  if (!ps._enabled || !ps._clipClient || !ps._clipClient.isConnected()) return;

  var trackKeys = Object.keys(ps._deviceListSnapshot);
  if (trackKeys.length === 0) return;

  // Rotate through tracks
  var idx = this._scanIndex % trackKeys.length;
  this._scanIndex = (this._scanIndex + 1) % trackKeys.length;
  var trackIdx = Number(trackKeys[idx]);

  // Per-track throttle
  var now = perf.now();
  var last = this._throttle[trackIdx] || 0;
  if (now - last < this._THROTTLE_MS) return;
  this._throttle[trackIdx] = now;

  // ECHO GUARD: skip locked tracks
  if (ps._isLocked(ps._devSlotKey(trackIdx))) return;

  // Poll devices on this track
  var deviceList = ps._deviceListSnapshot[trackIdx];
  if (!deviceList || deviceList.length === 0) return;

  var maxDevices = Math.min(deviceList.length, 4);
  for (var d = 0; d < maxDevices; d++) {
    this._pollDevice(trackIdx, d);
  }
};

// ---------------------------------------------------------------------------
// Poll one device — async TCP read, batch diff, send deltas
// ---------------------------------------------------------------------------

ParamWizard.prototype._pollDevice = function(trackIdx, devIdx) {
  var self = this;
  var ps = this._ps;

  ps._clipClient.getDeviceParameters(trackIdx, devIdx).then(function(result) {
    var params = Array.isArray(result) ? result : (result && result.parameters ? result.parameters : []);
    if (params.length === 0) return;

    // Double-check lock (async gap)
    if (ps._isLocked(ps._devSlotKey(trackIdx))) return;

    var batch = [];
    for (var p = 0; p < params.length; p++) {
      var param = params[p];
      var pName = param.name || ('P' + p);
      var val = param.value;
      var snapKey = trackIdx + ':' + devIdx + ':' + pName;
      var prev = self._snap[snapKey];

      if (prev !== undefined && prev !== val) {
        batch.push({ param_name: pName, value: val });
      }
      self._snap[snapKey] = val;
    }

    // Batch send
    if (batch.length > 0) {
      for (var b = 0; b < batch.length; b++) {
        ps._engine.sendSyncDelta('device_param', {
          track: trackIdx, device: devIdx,
          param_name: batch[b].param_name, value: batch[b].value
        });
      }
      ps._emit('local_change', {
        track: trackIdx, param: 'device_params',
        oldValue: null, newValue: batch.length + ' params',
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

/**
 * coLaB Cursor Sync
 * Polls Ableton's selection state via AbletonBridge TCP client,
 * broadcasts cursor position to peer via engine UDP,
 * receives partner cursor events.
 *
 * Replaces cursor-tracker.js (M4L-based) with AbletonBridge TCP polling.
 *
 * @module cursor-sync
 */

var C = require('../shared/constants');

function CursorSync(abletonClient, engine, options) {
  options = options || {};
  this._client = abletonClient;
  this._engine = engine;
  this._userId = options.userId || 'local';

  this._pollTimer = null;
  this._lastTrack = -1;
  this._lastTrackType = '';
  this._lastScene = -1;
  this._followPartner = false;
  this._enabled = true;

  // Partner state
  this._partnerCursor = null;

  // Events
  this._handlers = {};

  // Wire incoming cursor events from engine
  var self = this;
  this._engineCursorHandler = function(data) {
    self._onPartnerCursor(data);
  };
}

// ---------------------------------------------------------------------------
// Event emitter
// ---------------------------------------------------------------------------

CursorSync.prototype.on = function(event, handler) {
  if (!this._handlers[event]) this._handlers[event] = [];
  this._handlers[event].push(handler);
};

CursorSync.prototype._emit = function(event, data) {
  var handlers = this._handlers[event];
  if (!handlers) return;
  for (var i = 0; i < handlers.length; i++) {
    try { handlers[i](data); } catch(e) {}
  }
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

CursorSync.prototype.start = function() {
  this.stop();
  this._engine.on('cursor', this._engineCursorHandler);
  this._pollTimer = setInterval(this._poll.bind(this), C.CURSOR_POLL_MS);
};

CursorSync.prototype.stop = function() {
  if (this._pollTimer) {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }
  this._engine.off('cursor', this._engineCursorHandler);
};

// ---------------------------------------------------------------------------
// Polling: read local selection state, broadcast if changed
// ---------------------------------------------------------------------------

CursorSync.prototype._poll = function() {
  if (!this._enabled || !this._client.isConnected()) return;

  var self = this;
  this._client.getSelectionState().then(function(state) {
    var track = state.selected_track;
    var scene = state.selected_scene;

    var trackIdx = track ? track.index : -1;
    var trackType = track ? track.type : '';
    var sceneIdx = scene ? scene.index : -1;

    // Only send if position changed
    if (trackIdx !== self._lastTrack || sceneIdx !== self._lastScene || trackType !== self._lastTrackType) {
      self._lastTrack = trackIdx;
      self._lastTrackType = trackType;
      self._lastScene = sceneIdx;

      // Send via engine's existing cursor send API
      self._engine.sendCursor(trackIdx, sceneIdx, false, self._userId);

      self._emit('local_cursor', {
        track: trackIdx,
        trackType: trackType,
        trackName: track ? track.name : '',
        scene: sceneIdx,
        sceneName: scene ? scene.name : ''
      });
    }
  }).catch(function() {
    // Silently ignore polling errors (connection may be temporarily busy)
  });
};

// ---------------------------------------------------------------------------
// Partner cursor handling
// ---------------------------------------------------------------------------

CursorSync.prototype._onPartnerCursor = function(data) {
  this._partnerCursor = {
    track: data.trackIdx,
    scene: data.sceneIdx,
    editing: data.editing,
    userId: data.userId,
    timestamp: Date.now()
  };

  this._emit('partner_cursor', this._partnerCursor);

  // Optionally follow partner's cursor (move our selection to match)
  if (this._followPartner && this._client.isConnected()) {
    this._client.selectTrack(data.trackIdx).catch(function() {});
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

CursorSync.prototype.setEnabled = function(enabled) {
  this._enabled = enabled;
};

CursorSync.prototype.setFollowPartner = function(follow) {
  this._followPartner = follow;
};

CursorSync.prototype.getPartnerCursor = function() {
  return this._partnerCursor;
};

CursorSync.prototype.getLocalCursor = function() {
  return {
    track: this._lastTrack,
    trackType: this._lastTrackType,
    scene: this._lastScene
  };
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = CursorSync;
}

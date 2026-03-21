// coLaB Cursor Tracker
// Polls Ableton's selected track/scene and broadcasts to partner

var C = require('../shared/constants');

function CursorTracker(liveBridge, crdt) {
  this.liveBridge = liveBridge;
  this.crdt = crdt;
  this._pollTimer = null;
  this._lastTrack = -1;
  this._lastScene = -1;
  this._onRemoteCursorUpdate = null;
}

CursorTracker.prototype.start = function() {
  this.stop();
  this._pollTimer = setInterval(this._poll.bind(this), C.CURSOR_POLL_MS);
};

CursorTracker.prototype.stop = function() {
  if (this._pollTimer) {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }
};

CursorTracker.prototype._poll = function() {
  var trackIdx = this.liveBridge.getSelectedTrack();
  var sceneIdx = this.liveBridge.getSelectedScene();

  // Only update CRDT if position changed (reduces network traffic)
  if (trackIdx !== this._lastTrack || sceneIdx !== this._lastScene) {
    this._lastTrack = trackIdx;
    this._lastScene = sceneIdx;
    this.crdt.updateCursor(trackIdx, sceneIdx, false);
  }
};

CursorTracker.prototype.getRemoteCursor = function() {
  return this.crdt.getRemoteCursor();
};

CursorTracker.prototype.onRemoteCursorUpdate = function(callback) {
  this._onRemoteCursorUpdate = callback;
};

if (typeof module !== 'undefined') {
  module.exports = CursorTracker;
}

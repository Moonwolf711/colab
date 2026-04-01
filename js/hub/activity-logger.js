// coLaB Activity Logger
// Records all CRDT state changes with metadata for session recap
// Persists to JSON files in colab/data/sessions/

function ActivityLogger(userId, userName) {
  this.userId = userId;
  this.userName = userName || 'Producer';
  this._entries = [];
  this._sessionId = null;
  this._sessionStart = 0;
  this._lastDisconnect = 0;
  this._entrySeq = 0;
  this._flushTimer = null;
  this._dataDir = null;
}

// --- Session Lifecycle ---

ActivityLogger.prototype.startSession = function(sessionId, dataDir) {
  this._sessionId = sessionId;
  this._sessionStart = Date.now();
  this._entries = [];
  this._entrySeq = 0;
  this._dataDir = dataDir;

  this._addEntry('session', 'system', {
    event: 'session_start',
    userId: this.userId,
    userName: this.userName
  });

  // Flush to disk every 10 seconds
  this._flushTimer = setInterval(this._flushToDisk.bind(this), 10000);
};

ActivityLogger.prototype.endSession = function() {
  this._addEntry('session', 'system', {
    event: 'session_end',
    duration: Date.now() - this._sessionStart
  });

  this._flushToDisk();

  if (this._flushTimer) {
    clearInterval(this._flushTimer);
    this._flushTimer = null;
  }
};

ActivityLogger.prototype.recordDisconnect = function() {
  this._lastDisconnect = Date.now();
  this._addEntry('session', 'system', {
    event: 'disconnected',
    timestamp: this._lastDisconnect
  });
  this._flushToDisk();
};

ActivityLogger.prototype.recordReconnect = function() {
  this._addEntry('session', 'system', {
    event: 'reconnected',
    awayDuration: Date.now() - this._lastDisconnect
  });
};

// --- Change Logging ---

ActivityLogger.prototype.logTrackAdded = function(actor, trackId, trackData) {
  this._addEntry('track_add', actor, {
    trackId: trackId,
    name: trackData.name || 'Untitled',
    color: trackData.color || 0
  });
};

ActivityLogger.prototype.logTrackRemoved = function(actor, trackId, trackName) {
  this._addEntry('track_remove', actor, {
    trackId: trackId,
    name: trackName || 'Unknown'
  });
};

ActivityLogger.prototype.logTrackParam = function(actor, trackId, param, oldValue, newValue) {
  // Debounce rapid parameter changes (e.g. volume fader movement)
  var last = this._entries[this._entries.length - 1];
  if (last && last.type === 'track_param' && last.data.trackId === trackId &&
      last.data.param === param && (Date.now() - last.ts) < 500) {
    // Update the existing entry's newValue instead of creating a new one
    last.data.newValue = newValue;
    last.ts = Date.now();
    return;
  }

  this._addEntry('track_param', actor, {
    trackId: trackId,
    param: param,
    oldValue: oldValue,
    newValue: newValue
  });
};

ActivityLogger.prototype.logClipAdded = function(actor, trackId, clipId, clipData) {
  this._addEntry('clip_add', actor, {
    trackId: trackId,
    clipId: clipId,
    slot: clipData.slot,
    name: clipData.name || 'Clip'
  });
};

ActivityLogger.prototype.logClipRemoved = function(actor, trackId, clipId) {
  this._addEntry('clip_remove', actor, {
    trackId: trackId,
    clipId: clipId
  });
};

ActivityLogger.prototype.logNotesChanged = function(actor, trackId, clipId, noteCount) {
  this._addEntry('notes_change', actor, {
    trackId: trackId,
    clipId: clipId,
    noteCount: noteCount
  });
};

ActivityLogger.prototype.logTransportChange = function(actor, param, oldValue, newValue) {
  this._addEntry('transport', actor, {
    param: param,
    oldValue: oldValue,
    newValue: newValue
  });
};

// --- Query ---

ActivityLogger.prototype.getEntriesSince = function(timestamp) {
  var result = [];
  for (var i = 0; i < this._entries.length; i++) {
    if (this._entries[i].ts >= timestamp) {
      result.push(this._entries[i]);
    }
  }
  return result;
};

ActivityLogger.prototype.getEntries = function() {
  return this._entries.slice();
};

// --- Internal ---

ActivityLogger.prototype._addEntry = function(type, actor, data) {
  this._entries.push({
    id: this._entrySeq++,
    ts: Date.now(),
    type: type,
    actor: actor, // 'local', 'partner', or 'system'
    data: data
  });
};

ActivityLogger.prototype._flushToDisk = function() {
  if (!this._dataDir || this._entries.length === 0) return;

  // Build file path: session_<id>_<date>.json
  var dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  var filename = 'session_' + (this._sessionId || 'unknown') + '_' + dateStr + '.json';

  var payload = {
    sessionId: this._sessionId,
    userId: this.userId,
    userName: this.userName,
    startTime: this._sessionStart,
    lastUpdate: Date.now(),
    entryCount: this._entries.length,
    entries: this._entries
  };

  // Write to disk — this runs in M4L Node context OR web-bridge Node context
  try {
    if (typeof require !== 'undefined') {
      var fs = require('fs');
      var path = require('path');
      var filePath = path.join(this._dataDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    }
  } catch (e) {
    // Silently fail in M4L JS context (no fs)
    // Web-bridge will handle persistence separately
  }
};

ActivityLogger.prototype.destroy = function() {
  this.endSession();
};

if (typeof module !== 'undefined') {
  module.exports = ActivityLogger;
}

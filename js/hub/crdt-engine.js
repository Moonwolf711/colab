// coLaB CRDT State Engine
// Uses Yjs for conflict-free replicated data types

var Y = require('yjs');

function CRDTEngine(userId) {
  this.userId = userId;
  this.doc = new Y.Doc();
  this._onRemoteChange = null;
  this._onLocalUpdate = null;
  this._seq = 0;

  // Initialize shared types
  this.tracks = this.doc.getMap('tracks');
  this.transport = this.doc.getMap('transport');
  this.cursors = this.doc.getMap('cursors');

  // Initialize transport defaults
  this.doc.transact(function() {
    this.transport.set('playing', false);
    this.transport.set('position', 0.0);
    this.transport.set('tempo', 120.0);
    this.transport.set('loopEnabled', false);
    this.transport.set('loopStart', 0.0);
    this.transport.set('loopLength', 8.0);
  }.bind(this));

  // Listen for remote updates to apply to Ableton
  this.tracks.observeDeep(this._handleTracksChange.bind(this));
  this.transport.observe(this._handleTransportChange.bind(this));

  // Capture local updates for network broadcast
  this.doc.on('update', function(update, origin) {
    if (origin === 'local' && this._onLocalUpdate) {
      this._onLocalUpdate(update);
    }
  }.bind(this));
}

// --- Local Operations (Ableton → Yjs) ---

CRDTEngine.prototype.addTrack = function(trackId, trackData) {
  this.doc.transact(function() {
    var trackMap = new Y.Map();
    trackMap.set('name', trackData.name || 'Untitled');
    trackMap.set('color', trackData.color || 0);
    trackMap.set('volume', trackData.volume || 0.85);
    trackMap.set('pan', trackData.pan || 0.0);
    trackMap.set('mute', trackData.mute || false);
    trackMap.set('solo', trackData.solo || false);
    trackMap.set('owner', this.userId);

    var clipsMap = new Y.Map();
    trackMap.set('clips', clipsMap);

    this.tracks.set(trackId, trackMap);
  }.bind(this), 'local');
};

CRDTEngine.prototype.removeTrack = function(trackId) {
  this.doc.transact(function() {
    this.tracks.delete(trackId);
  }.bind(this), 'local');
};

CRDTEngine.prototype.updateTrackParam = function(trackId, param, value) {
  this.doc.transact(function() {
    var track = this.tracks.get(trackId);
    if (track) {
      track.set(param, value);
    }
  }.bind(this), 'local');
};

CRDTEngine.prototype.addClip = function(trackId, clipId, clipData) {
  this.doc.transact(function() {
    var track = this.tracks.get(trackId);
    if (!track) return;

    var clips = track.get('clips');
    var clipMap = new Y.Map();
    clipMap.set('name', clipData.name || 'Clip');
    clipMap.set('slot', clipData.slot || 0);
    clipMap.set('length', clipData.length || 4.0);
    clipMap.set('looping', clipData.looping !== undefined ? clipData.looping : true);

    var notesArr = new Y.Array();
    if (clipData.notes) {
      for (var i = 0; i < clipData.notes.length; i++) {
        var noteMap = new Y.Map();
        var n = clipData.notes[i];
        noteMap.set('pitch', n.pitch);
        noteMap.set('time', n.time);
        noteMap.set('duration', n.duration);
        noteMap.set('velocity', n.velocity);
        noteMap.set('mute', n.mute || false);
        notesArr.push([noteMap]);
      }
    }
    clipMap.set('notes', notesArr);

    clips.set(clipId, clipMap);
  }.bind(this), 'local');
};

CRDTEngine.prototype.removeClip = function(trackId, clipId) {
  this.doc.transact(function() {
    var track = this.tracks.get(trackId);
    if (!track) return;
    var clips = track.get('clips');
    clips.delete(clipId);
  }.bind(this), 'local');
};

CRDTEngine.prototype.setClipNotes = function(trackId, clipId, notes) {
  this.doc.transact(function() {
    var track = this.tracks.get(trackId);
    if (!track) return;
    var clip = track.get('clips').get(clipId);
    if (!clip) return;

    // Replace notes array
    var notesArr = new Y.Array();
    for (var i = 0; i < notes.length; i++) {
      var noteMap = new Y.Map();
      var n = notes[i];
      noteMap.set('pitch', n.pitch);
      noteMap.set('time', n.time);
      noteMap.set('duration', n.duration);
      noteMap.set('velocity', n.velocity);
      noteMap.set('mute', n.mute || false);
      notesArr.push([noteMap]);
    }
    clip.set('notes', notesArr);
  }.bind(this), 'local');
};

// --- Cursor ---

CRDTEngine.prototype.updateCursor = function(trackIdx, sceneIdx, editing) {
  this.doc.transact(function() {
    var cursorMap = this.cursors.get(this.userId);
    if (!cursorMap) {
      cursorMap = new Y.Map();
      this.cursors.set(this.userId, cursorMap);
    }
    cursorMap.set('track', trackIdx);
    cursorMap.set('scene', sceneIdx);
    cursorMap.set('editing', editing);
    cursorMap.set('timestamp', Date.now());
  }.bind(this), 'local');
};

CRDTEngine.prototype.getRemoteCursor = function() {
  var result = null;
  var self = this;
  this.cursors.forEach(function(value, key) {
    if (key !== self.userId) {
      result = {
        userId: key,
        track: value.get('track'),
        scene: value.get('scene'),
        editing: value.get('editing'),
        timestamp: value.get('timestamp')
      };
    }
  });
  return result;
};

// --- Remote Operations (Network → Yjs) ---

CRDTEngine.prototype.applyRemoteUpdate = function(update) {
  Y.applyUpdate(this.doc, update, 'remote');
};

CRDTEngine.prototype.getStateVector = function() {
  return Y.encodeStateVector(this.doc);
};

CRDTEngine.prototype.getFullState = function() {
  return Y.encodeStateAsUpdate(this.doc);
};

CRDTEngine.prototype.getMissingSince = function(remoteStateVector) {
  return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
};

// --- Change Handlers ---

CRDTEngine.prototype._handleTracksChange = function(events, transaction) {
  if (transaction.origin === 'local') return; // Don't echo our own changes
  if (this._onRemoteChange) {
    this._onRemoteChange('tracks', events);
  }
};

CRDTEngine.prototype._handleTransportChange = function(event, transaction) {
  if (transaction.origin === 'local') return;
  if (this._onRemoteChange) {
    this._onRemoteChange('transport', event);
  }
};

// --- Event Registration ---

CRDTEngine.prototype.onRemoteChange = function(callback) {
  this._onRemoteChange = callback;
};

CRDTEngine.prototype.onLocalUpdate = function(callback) {
  this._onLocalUpdate = callback;
};

// --- Utility ---

CRDTEngine.prototype.getTrackIds = function() {
  var ids = [];
  this.tracks.forEach(function(value, key) {
    ids.push(key);
  });
  return ids;
};

CRDTEngine.prototype.getTrack = function(trackId) {
  var track = this.tracks.get(trackId);
  if (!track) return null;
  return {
    name: track.get('name'),
    color: track.get('color'),
    volume: track.get('volume'),
    pan: track.get('pan'),
    mute: track.get('mute'),
    solo: track.get('solo'),
    owner: track.get('owner')
  };
};

CRDTEngine.prototype.destroy = function() {
  this.doc.destroy();
};

if (typeof module !== 'undefined') {
  module.exports = CRDTEngine;
}

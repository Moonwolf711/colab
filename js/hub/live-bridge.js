// coLaB Live Object Model Bridge
// Reads and writes Ableton Live session state via Max for Live LiveAPI

// Note: This file runs inside Max for Live's JS environment
// LiveAPI is a global provided by Max's js object

var C = require('../shared/constants');

function LiveBridge() {
  this._listeners = [];
  this._lastState = null;
  this._suppressEcho = false;
}

// --- Read Operations ---

LiveBridge.prototype.getTracks = function() {
  var liveSet = new LiveAPI('live_set');
  var trackCount = liveSet.getcount('tracks');
  var tracks = [];

  for (var i = 0; i < trackCount; i++) {
    var track = new LiveAPI('live_set tracks ' + i);
    tracks.push({
      index: i,
      id: track.id,
      name: track.get('name').toString(),
      color: parseInt(track.get('color')),
      volume: parseFloat(new LiveAPI('live_set tracks ' + i + ' mixer_device volume').get('value')),
      pan: parseFloat(new LiveAPI('live_set tracks ' + i + ' mixer_device panning').get('value')),
      mute: parseInt(track.get('mute')) === 1,
      solo: parseInt(track.get('solo')) === 1,
      clipSlots: this._getClipSlots(i)
    });
  }

  return tracks;
};

LiveBridge.prototype._getClipSlots = function(trackIdx) {
  var track = new LiveAPI('live_set tracks ' + trackIdx);
  var slotCount = track.getcount('clip_slots');
  var slots = [];

  for (var s = 0; s < slotCount; s++) {
    var slot = new LiveAPI('live_set tracks ' + trackIdx + ' clip_slots ' + s);
    var hasClip = parseInt(slot.get('has_clip')) === 1;

    if (hasClip) {
      var clip = new LiveAPI('live_set tracks ' + trackIdx + ' clip_slots ' + s + ' clip');
      slots.push({
        slot: s,
        name: clip.get('name').toString(),
        length: parseFloat(clip.get('length')),
        looping: parseInt(clip.get('looping')) === 1,
        startMarker: parseFloat(clip.get('start_marker')),
        endMarker: parseFloat(clip.get('end_marker')),
        notes: this._getClipNotes(trackIdx, s)
      });
    }
  }

  return slots;
};

LiveBridge.prototype._getClipNotes = function(trackIdx, slotIdx) {
  var clip = new LiveAPI('live_set tracks ' + trackIdx + ' clip_slots ' + slotIdx + ' clip');
  // get_notes returns: note count, then [pitch, time, duration, velocity, mute] per note
  var noteData = clip.call('get_notes', 0, 0, parseFloat(clip.get('length')), 128);
  var notes = [];

  if (noteData && noteData.length > 1) {
    var count = noteData[1]; // "notes" count
    // Each note: pitch time duration velocity mute
    for (var i = 2; i < noteData.length; i += 6) {
      if (noteData[i] === 'note') {
        notes.push({
          pitch: parseInt(noteData[i + 1]),
          time: parseFloat(noteData[i + 2]),
          duration: parseFloat(noteData[i + 3]),
          velocity: parseInt(noteData[i + 4]),
          mute: parseInt(noteData[i + 5]) === 1
        });
      }
    }
  }

  return notes;
};

// --- Write Operations ---

LiveBridge.prototype.createTrack = function(index, name) {
  this._suppressEcho = true;
  var liveSet = new LiveAPI('live_set');
  liveSet.call('create_midi_track', index);
  var track = new LiveAPI('live_set tracks ' + index);
  track.set('name', name);
  this._suppressEcho = false;
  return track.id;
};

LiveBridge.prototype.deleteTrack = function(index) {
  this._suppressEcho = true;
  var track = new LiveAPI('live_set tracks ' + index);
  track.call('delete_track');
  this._suppressEcho = false;
};

LiveBridge.prototype.setTrackName = function(index, name) {
  this._suppressEcho = true;
  var track = new LiveAPI('live_set tracks ' + index);
  track.set('name', name);
  this._suppressEcho = false;
};

LiveBridge.prototype.setTrackVolume = function(index, value) {
  this._suppressEcho = true;
  var vol = new LiveAPI('live_set tracks ' + index + ' mixer_device volume');
  vol.set('value', value);
  this._suppressEcho = false;
};

LiveBridge.prototype.createClip = function(trackIdx, slotIdx, length) {
  this._suppressEcho = true;
  var slot = new LiveAPI('live_set tracks ' + trackIdx + ' clip_slots ' + slotIdx);
  slot.call('create_clip', length);
  this._suppressEcho = false;
};

LiveBridge.prototype.setClipNotes = function(trackIdx, slotIdx, notes) {
  this._suppressEcho = true;
  var clip = new LiveAPI('live_set tracks ' + trackIdx + ' clip_slots ' + slotIdx + ' clip');

  clip.call('select_all_notes');
  clip.call('replace_selected_notes');
  clip.call('notes', notes.length);

  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    clip.call('note', n.pitch, n.time.toFixed(4), n.duration.toFixed(4), n.velocity, n.mute ? 1 : 0);
  }

  clip.call('done');
  this._suppressEcho = false;
};

// --- Cursor / Selection ---

LiveBridge.prototype.getSelectedTrack = function() {
  var view = new LiveAPI('live_set view');
  var selectedTrack = view.get('selected_track');
  // Returns "id <number>" — extract the id
  if (selectedTrack && selectedTrack.length >= 2) {
    // Find the track index by ID
    var trackId = parseInt(selectedTrack[1]);
    var liveSet = new LiveAPI('live_set');
    var trackCount = liveSet.getcount('tracks');
    for (var i = 0; i < trackCount; i++) {
      var t = new LiveAPI('live_set tracks ' + i);
      if (parseInt(t.id) === trackId) return i;
    }
  }
  return 0;
};

LiveBridge.prototype.getSelectedScene = function() {
  var view = new LiveAPI('live_set view');
  var selectedScene = view.get('selected_scene');
  if (selectedScene && selectedScene.length >= 2) {
    var sceneId = parseInt(selectedScene[1]);
    var liveSet = new LiveAPI('live_set');
    var sceneCount = liveSet.getcount('scenes');
    for (var i = 0; i < sceneCount; i++) {
      var s = new LiveAPI('live_set scenes ' + i);
      if (parseInt(s.id) === sceneId) return i;
    }
  }
  return 0;
};

LiveBridge.prototype.getTransportState = function() {
  var liveSet = new LiveAPI('live_set');
  return {
    playing: parseInt(liveSet.get('is_playing')) === 1,
    tempo: parseFloat(liveSet.get('tempo')),
    position: parseFloat(liveSet.get('current_song_time')),
    loopEnabled: parseInt(liveSet.get('loop')) === 1,
    loopStart: parseFloat(liveSet.get('loop_start')),
    loopLength: parseFloat(liveSet.get('loop_length'))
  };
};

// --- Echo Suppression ---

LiveBridge.prototype.isSuppressingEcho = function() {
  return this._suppressEcho;
};

// Export
if (typeof module !== 'undefined') {
  module.exports = LiveBridge;
}

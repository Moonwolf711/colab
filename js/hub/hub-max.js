// coLaB Hub — Max for Live JavaScript
// Self-contained, no require(), uses Max JS API
// Proof of concept: read tracks, poll cursor, UDP messaging

inlets = 1;
outlets = 2; // outlet 0: UI messages, outlet 1: network out

// --- State ---
var userId = 'user-' + Math.random().toString(36).substr(2, 6);
var userName = 'Producer';
var connected = false;
var partnerIp = '';
var tracks = [];
var cursorTrack = -1;
var cursorScene = -1;
var remoteCursorTrack = -1;
var remoteCursorScene = -1;
var pollTask = null;

// --- Initialization ---

function init() {
  post('coLaB Hub v0.1.0 initializing...\n');
  post('userId: ' + userId + '\n');
  readTracks();
  startPolling();
  post('coLaB Hub ready. Found ' + tracks.length + ' tracks.\n');
  outlet(0, 'status', 'Ready');
}

// --- Read Ableton State ---

function readTracks() {
  tracks = [];
  try {
    var liveSet = new LiveAPI('live_set');
    var trackCount = liveSet.getcount('tracks');

    for (var i = 0; i < trackCount; i++) {
      var track = new LiveAPI('live_set tracks ' + i);
      var name = track.get('name').toString();
      var color = parseInt(track.get('color'));
      var mute = parseInt(track.get('mute')) === 1;
      var solo = parseInt(track.get('solo')) === 1;

      tracks.push({
        index: i,
        name: name,
        color: color,
        mute: mute,
        solo: solo
      });

      post('  Track ' + i + ': ' + name + '\n');
    }
  } catch(e) {
    post('Error reading tracks: ' + e + '\n');
  }
}

function getSelectedTrack() {
  try {
    var view = new LiveAPI('live_set view');
    var sel = view.get('selected_track');
    if (sel && sel.length >= 2) {
      var trackId = parseInt(sel[1]);
      var liveSet = new LiveAPI('live_set');
      var count = liveSet.getcount('tracks');
      for (var i = 0; i < count; i++) {
        var t = new LiveAPI('live_set tracks ' + i);
        if (parseInt(t.id) === trackId) return i;
      }
    }
  } catch(e) {}
  return 0;
}

function getSelectedScene() {
  try {
    var view = new LiveAPI('live_set view');
    var sel = view.get('selected_scene');
    if (sel && sel.length >= 2) {
      var sceneId = parseInt(sel[1]);
      var liveSet = new LiveAPI('live_set');
      var count = liveSet.getcount('scenes');
      for (var i = 0; i < count; i++) {
        var s = new LiveAPI('live_set scenes ' + i);
        if (parseInt(s.id) === sceneId) return i;
      }
    }
  } catch(e) {}
  return 0;
}

function getTransport() {
  try {
    var ls = new LiveAPI('live_set');
    return {
      playing: parseInt(ls.get('is_playing')) === 1,
      tempo: parseFloat(ls.get('tempo')),
      position: parseFloat(ls.get('current_song_time'))
    };
  } catch(e) {
    return { playing: false, tempo: 120, position: 0 };
  }
}

// --- Cursor Polling ---

function startPolling() {
  if (pollTask) {
    pollTask.cancel();
  }
  pollTask = new Task(pollCursor, this);
  pollTask.interval = 66; // ~15Hz
  pollTask.repeat();
  post('Cursor polling started at 15Hz\n');
}

function stopPolling() {
  if (pollTask) {
    pollTask.cancel();
    pollTask = null;
  }
}

function pollCursor() {
  var t = getSelectedTrack();
  var s = getSelectedScene();

  if (t !== cursorTrack || s !== cursorScene) {
    cursorTrack = t;
    cursorScene = s;

    var trackName = (tracks[t] && tracks[t].name) ? tracks[t].name : 'Track ' + t;
    outlet(0, 'cursor', 'You: Track ' + t + ' (' + trackName + ') Scene ' + s);

    // Send cursor update to partner
    if (connected) {
      outlet(1, 'cursor', userId, t, s);
    }
  }
}

// --- Connection ---

function connect(ip) {
  partnerIp = ip;
  connected = true;
  post('coLaB: Connected to ' + ip + '\n');
  outlet(0, 'status', 'Connected to ' + ip);

  // Send our track list to partner
  sendTrackList();
}

function disconnect() {
  connected = false;
  partnerIp = '';
  remoteCursorTrack = -1;
  remoteCursorScene = -1;
  post('coLaB: Disconnected\n');
  outlet(0, 'status', 'Disconnected');
  outlet(0, 'partner', 'Partner: --');
}

// --- Send State ---

function sendTrackList() {
  if (!connected) return;

  for (var i = 0; i < tracks.length; i++) {
    outlet(1, 'track', i, tracks[i].name);
  }
  post('Sent ' + tracks.length + ' tracks to partner\n');
}

// --- Receive from Partner ---

function incoming(type) {
  // Called from Max when UDP data arrives
  // Arguments after type are the data
  var args = arrayfromargs(arguments);

  if (type === 'cursor') {
    // cursor <userId> <trackIdx> <sceneIdx>
    if (args.length >= 4) {
      remoteCursorTrack = parseInt(args[2]);
      remoteCursorScene = parseInt(args[3]);
      outlet(0, 'partner', 'Partner: Track ' + remoteCursorTrack + ' Scene ' + remoteCursorScene);
    }
  }
  else if (type === 'track') {
    // track <index> <name>
    post('Partner track: ' + args[1] + ' = ' + args[2] + '\n');
  }
  else if (type === 'ping') {
    outlet(1, 'pong', Date.now());
  }
  else if (type === 'pong') {
    if (args.length >= 2) {
      var latency = Date.now() - parseInt(args[1]);
      outlet(0, 'latency', 'Latency: ' + latency + 'ms');
    }
  }
}

// --- Track Operations ---

function createTrack(name) {
  try {
    var ls = new LiveAPI('live_set');
    var count = ls.getcount('tracks');
    ls.call('create_midi_track', count);
    var track = new LiveAPI('live_set tracks ' + count);
    track.set('name', name || 'coLaB Track');
    readTracks(); // refresh
    post('Created track: ' + name + '\n');

    if (connected) sendTrackList();
  } catch(e) {
    post('Error creating track: ' + e + '\n');
  }
}

function createClip(trackIdx, slotIdx, length) {
  try {
    var slot = new LiveAPI('live_set tracks ' + trackIdx + ' clip_slots ' + slotIdx);
    slot.call('create_clip', length || 4.0);
    post('Created clip on track ' + trackIdx + ' slot ' + slotIdx + '\n');
  } catch(e) {
    post('Error creating clip: ' + e + '\n');
  }
}

// --- Refresh ---

function refresh() {
  readTracks();
  post('Refreshed: ' + tracks.length + ' tracks\n');
  outlet(0, 'status', 'Refreshed: ' + tracks.length + ' tracks');
}

// --- Ping ---

function ping() {
  if (connected) {
    outlet(1, 'ping', Date.now());
    post('Ping sent\n');
  } else {
    post('Not connected\n');
  }
}

// --- Debug ---

function bang() {
  readTracks();
  var transport = getTransport();
  post('--- coLaB Hub Status ---\n');
  post('Connected: ' + connected + '\n');
  post('Partner: ' + (partnerIp || 'none') + '\n');
  post('Tracks: ' + tracks.length + '\n');
  post('Cursor: Track ' + cursorTrack + ' Scene ' + cursorScene + '\n');
  post('Remote Cursor: Track ' + remoteCursorTrack + ' Scene ' + remoteCursorScene + '\n');
  post('Transport: ' + (transport.playing ? 'playing' : 'stopped') + ' @ ' + transport.tempo + ' BPM\n');
  post('------------------------\n');
}

// --- Cleanup ---

function notifydeleted() {
  stopPolling();
  post('coLaB Hub destroyed.\n');
}

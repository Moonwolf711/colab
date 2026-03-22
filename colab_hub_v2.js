post("coLaB Hub loading...\n");

var inlets = 1;
var outlets = 2;

var userId = 'user-' + Math.random().toString(36).substr(2, 6);
var tracks = [];
var cursorTrack = -1;
var cursorScene = -1;
var pollTask = null;
var connected = false;
var partnerIp = '';

function init() {
  post("coLaB Hub v0.1 initializing...\n");
  post("userId: " + userId + "\n");
  readTracks();
  startPolling();
  post("coLaB Hub ready. Found " + tracks.length + " tracks.\n");
}

function readTracks() {
  tracks = [];
  var liveSet = new LiveAPI("live_set");
  var count = liveSet.getcount("tracks");
  for (var i = 0; i < count; i++) {
    var t = new LiveAPI("live_set tracks " + i);
    var name = t.get("name").toString();
    tracks.push({ index: i, name: name });
    post("  Track " + i + ": " + name + "\n");
  }
}

function getSelectedTrack() {
  var view = new LiveAPI("live_set view");
  var sel = view.get("selected_track");
  if (sel && sel.length >= 2) {
    var trackId = parseInt(sel[1]);
    var liveSet = new LiveAPI("live_set");
    var count = liveSet.getcount("tracks");
    for (var i = 0; i < count; i++) {
      var t = new LiveAPI("live_set tracks " + i);
      if (parseInt(t.id) === trackId) return i;
    }
  }
  return 0;
}

function getSelectedScene() {
  var view = new LiveAPI("live_set view");
  var sel = view.get("selected_scene");
  if (sel && sel.length >= 2) {
    var sceneId = parseInt(sel[1]);
    var liveSet = new LiveAPI("live_set");
    var count = liveSet.getcount("scenes");
    for (var i = 0; i < count; i++) {
      var s = new LiveAPI("live_set scenes " + i);
      if (parseInt(s.id) === sceneId) return i;
    }
  }
  return 0;
}

function startPolling() {
  if (pollTask) pollTask.cancel();
  pollTask = new Task(pollCursor, this);
  pollTask.interval = 66;
  pollTask.repeat();
  post("Cursor polling started at 15Hz\n");
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
    var name = (tracks[t] && tracks[t].name) ? tracks[t].name : "Track " + t;
    outlet(0, "cursor", t, name, s);
    post("Cursor: Track " + t + " (" + name + ") Scene " + s + "\n");
  }
}

function refresh() {
  readTracks();
  post("Refreshed: " + tracks.length + " tracks\n");
}

function bang() {
  var transport = new LiveAPI("live_set");
  var playing = parseInt(transport.get("is_playing")) === 1;
  var tempo = parseFloat(transport.get("tempo"));
  post("\n--- coLaB Hub ---\n");
  post("Tracks: " + tracks.length + "\n");
  post("Cursor: Track " + cursorTrack + " Scene " + cursorScene + "\n");
  post("Transport: " + (playing ? "PLAYING" : "stopped") + " @ " + tempo + " BPM\n");
  post("-----------------\n");
}

function notifydeleted() {
  stopPolling();
  post("coLaB Hub destroyed.\n");
}

post("coLaB Hub script ready.\n");

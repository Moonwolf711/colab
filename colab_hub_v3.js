post("coLaB Hub v0.3 loading...\n");

var inlets = 2;   // 0: messages, 1: incoming from partner (udpreceive)
var outlets = 2;   // 0: UI/status, 1: outgoing to partner (udpsend)

// === STATE ===
var userId = 'user-' + Math.random().toString(36).substr(2, 6);
var tracks = [];
var cursorTrack = -1;
var cursorScene = -1;
var pollTask = null;
var connected = false;
var partnerHost = "";
var partnerPort = 8001;
var lastPlaying = false;
var lastTempo = 120.0;

// === INIT (called after live.thisdevice bang) ===
function init() {
  post("coLaB Hub v0.3 initializing...\n");
  post("userId: " + userId + "\n");
  readTracks();
  startPolling();
  post("Ready. " + tracks.length + " tracks found.\n");
  post("To connect: send 'connect <IP>' to inlet 0\n");
}

// === READ TRACKS ===
function readTracks() {
  tracks = [];
  try {
    var liveSet = new LiveAPI("live_set");
    var count = liveSet.getcount("tracks");
    for (var i = 0; i < count; i++) {
      var t = new LiveAPI("live_set tracks " + i);
      var name = t.get("name").toString();
      var mute = parseInt(t.get("mute")) === 1;
      var solo = parseInt(t.get("solo")) === 1;
      var arm = parseInt(t.get("arm")) === 1;
      tracks.push({ index: i, name: name, mute: mute, solo: solo, arm: arm });
      post("  Track " + i + ": " + name + (mute ? " [M]" : "") + (solo ? " [S]" : "") + (arm ? " [R]" : "") + "\n");
    }
  } catch(e) {
    post("readTracks error: " + e + "\n");
  }
}

// === CURSOR / SELECTION ===
function getSelectedTrack() {
  try {
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
  } catch(e) {}
  return 0;
}

function getSelectedScene() {
  try {
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
  } catch(e) {}
  return 0;
}

function setSelectedTrack(idx) {
  try {
    var view = new LiveAPI("live_set view");
    var t = new LiveAPI("live_set tracks " + idx);
    view.set("selected_track", "id", parseInt(t.id));
  } catch(e) {
    post("setSelectedTrack error: " + e + "\n");
  }
}

function setSelectedScene(idx) {
  try {
    var view = new LiveAPI("live_set view");
    var s = new LiveAPI("live_set scenes " + idx);
    view.set("selected_scene", "id", parseInt(s.id));
  } catch(e) {
    post("setSelectedScene error: " + e + "\n");
  }
}

// === POLLING (cursor + transport) ===
function startPolling() {
  if (pollTask) pollTask.cancel();
  pollTask = new Task(pollCursor, this);
  pollTask.interval = 66; // ~15Hz
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
  try {
    var t = getSelectedTrack();
    var s = getSelectedScene();
    var ls = new LiveAPI("live_set");
    var isPlaying = parseInt(ls.get("is_playing")) === 1;
    var tempo = parseFloat(ls.get("tempo"));

    if (t !== cursorTrack || s !== cursorScene || isPlaying !== lastPlaying || Math.abs(tempo - lastTempo) > 0.01) {
      cursorTrack = t;
      cursorScene = s;
      lastPlaying = isPlaying;
      lastTempo = tempo;

      var name = (tracks[t] && tracks[t].name) ? tracks[t].name : "Track " + t;
      outlet(0, "cursor", t, name, s);

      if (connected) {
        var payload = JSON.stringify({
          type: "state",
          user: userId,
          track: t,
          scene: s,
          playing: isPlaying,
          tempo: tempo,
          ts: Date.now()
        });
        outlet(1, payload);
      }
    }
  } catch(e) {
    // Silently ignore polling errors to keep task alive
  }
}

// === CONNECTION ===
function connect(ip) {
  partnerHost = ip.toString();
  partnerPort = 8001;
  connected = true;
  post("Connected to " + partnerHost + ":" + partnerPort + "\n");
  outlet(0, "status", "Connected to " + partnerHost);
  // Send our track list
  if (connected) {
    var payload = JSON.stringify({ type: "tracks", user: userId, tracks: tracks, ts: Date.now() });
    outlet(1, payload);
  }
}

function disconnect() {
  connected = false;
  partnerHost = "";
  post("Disconnected\n");
  outlet(0, "status", "Disconnected");
}

// === REMOTE CONTROL (send commands to partner's Ableton) ===
function remote_set() {
  var a = arrayfromargs(arguments);
  if (a.length < 3) { post("Usage: remote_set <path> <prop> <value>\n"); return; }
  var path = a[0];
  var prop = a[1];
  var value = a[2];
  try {
    // Apply locally
    var api = new LiveAPI("live_set " + path);
    api.set(prop, value);
    post("SET " + path + " " + prop + " = " + value + "\n");
    // Send to partner
    if (connected) {
      var payload = JSON.stringify({ type: "set", user: userId, path: path, prop: prop, value: value, ts: Date.now() });
      outlet(1, payload);
    }
  } catch(e) { post("remote_set error: " + e + "\n"); }
}

function remote_launch() {
  var a = arrayfromargs(arguments);
  if (a.length < 2) { post("Usage: remote_launch <track> <scene>\n"); return; }
  var track = parseInt(a[0]);
  var scene = parseInt(a[1]);
  try {
    var api = new LiveAPI("live_set tracks " + track + " clip_slots " + scene);
    api.call("fire");
    post("LAUNCH Track " + track + " Scene " + scene + "\n");
    if (connected) {
      var payload = JSON.stringify({ type: "launch", user: userId, track: track, scene: scene, ts: Date.now() });
      outlet(1, payload);
    }
  } catch(e) { post("remote_launch error: " + e + "\n"); }
}

function remote_stop() {
  var a = arrayfromargs(arguments);
  if (a.length < 2) { post("Usage: remote_stop <track> <scene>\n"); return; }
  var track = parseInt(a[0]);
  var scene = parseInt(a[1]);
  try {
    var api = new LiveAPI("live_set tracks " + track + " clip_slots " + scene + " clip");
    api.call("stop");
    post("STOP Track " + track + " Scene " + scene + "\n");
  } catch(e) { post("remote_stop error: " + e + "\n"); }
}

// === TRANSPORT CONTROL ===
function play() {
  try {
    var ls = new LiveAPI("live_set");
    ls.call("start_playing");
    post("PLAY\n");
    if (connected) outlet(1, JSON.stringify({ type: "transport", action: "play", user: userId, ts: Date.now() }));
  } catch(e) { post("play error: " + e + "\n"); }
}

function stop() {
  try {
    var ls = new LiveAPI("live_set");
    ls.call("stop_playing");
    post("STOP\n");
    if (connected) outlet(1, JSON.stringify({ type: "transport", action: "stop", user: userId, ts: Date.now() }));
  } catch(e) { post("stop error: " + e + "\n"); }
}

function tempo() {
  var a = arrayfromargs(arguments);
  if (a.length < 1) { post("Usage: tempo <bpm>\n"); return; }
  try {
    var ls = new LiveAPI("live_set");
    ls.set("tempo", parseFloat(a[0]));
    post("TEMPO = " + a[0] + " BPM\n");
    if (connected) outlet(1, JSON.stringify({ type: "transport", action: "tempo", value: parseFloat(a[0]), user: userId, ts: Date.now() }));
  } catch(e) { post("tempo error: " + e + "\n"); }
}

// === INCOMING FROM PARTNER (inlet 1 via udpreceive) ===
function incoming() {
  // This is called when we receive JSON from partner
  var a = arrayfromargs(arguments);
  var raw = a.join(" ");
  try {
    var data = JSON.parse(raw);
    if (data.user === userId) return; // ignore echo

    if (data.type === "set") {
      var api = new LiveAPI("live_set " + data.path);
      api.set(data.prop, data.value);
      post("REMOTE " + data.user + ": set " + data.path + " " + data.prop + " = " + data.value + "\n");
    }
    else if (data.type === "launch") {
      var api2 = new LiveAPI("live_set tracks " + data.track + " clip_slots " + data.scene);
      api2.call("fire");
      post("REMOTE " + data.user + ": launch track " + data.track + " scene " + data.scene + "\n");
    }
    else if (data.type === "transport") {
      var ls = new LiveAPI("live_set");
      if (data.action === "play") ls.call("start_playing");
      else if (data.action === "stop") ls.call("stop_playing");
      else if (data.action === "tempo") ls.set("tempo", data.value);
      post("REMOTE " + data.user + ": " + data.action + "\n");
    }
    else if (data.type === "state") {
      // Update cursor display
      outlet(0, "partner", "Partner: Track " + data.track + " Scene " + data.scene);
      post("REMOTE " + data.user + ": cursor track " + data.track + " scene " + data.scene + "\n");
    }
    else if (data.type === "tracks") {
      post("REMOTE " + data.user + " has " + data.tracks.length + " tracks\n");
    }
  } catch(e) {
    post("incoming parse error: " + e + "\n");
  }
}

// === STATUS ===
function bang() {
  try {
    readTracks();
    var ls = new LiveAPI("live_set");
    var playing = parseInt(ls.get("is_playing")) === 1;
    var bpm = parseFloat(ls.get("tempo"));
    post("\n=== coLaB Hub v0.3 ===\n");
    post("Connected: " + connected + (connected ? " (" + partnerHost + ")" : "") + "\n");
    post("Tracks: " + tracks.length + "\n");
    post("Cursor: Track " + cursorTrack + " Scene " + cursorScene + "\n");
    post("Transport: " + (playing ? "PLAYING" : "stopped") + " @ " + bpm + " BPM\n");
    post("======================\n");
  } catch(e) {
    post("status error: " + e + "\n");
  }
}

function refresh() {
  readTracks();
  post("Refreshed: " + tracks.length + " tracks\n");
}

function notifydeleted() {
  stopPolling();
  post("coLaB Hub destroyed.\n");
}

post("coLaB Hub v0.3 loaded. Send 'init' to start.\n");

// coLaB Hub v0.4.1 – FIXED polling crash

var inlets = 1;
var outlets = 2;

var userId = 'user-' + Math.random().toString(36).substr(2, 6);
var tracks = [];
var cursorTrack = -1;
var cursorScene = -1;
var pollTask = null;
var connected = false;
var partnerHost = "";
var partnerPort = 8001;
var liveSet = null;
var trackIdMap = {};  // id → index lookup (fast)
var sceneIdMap = {};  // id → index lookup (fast)
var viewAPI = null;   // cached view API

function init() {
    post("coLaB Hub v0.4.1 initializing...\n");
    post("userId: " + userId + "\n");
    liveSet = new LiveAPI("live_set");
    viewAPI = new LiveAPI("live_set view");
    readTracks();
    buildSceneMap();
    startPolling();
    post("Ready. " + tracks.length + " tracks. Polling active.\n");
}

function readTracks() {
    tracks = [];
    trackIdMap = {};
    var count = liveSet.getcount("tracks");
    for (var i = 0; i < count; i++) {
        var t = new LiveAPI("live_set tracks " + i);
        var name = t.get("name").toString();
        var tid = parseInt(t.id);
        tracks.push({ index: i, name: name, id: tid });
        trackIdMap[tid] = i;
        post("  Track " + i + ": " + name + "\n");
    }
}

function buildSceneMap() {
    sceneIdMap = {};
    var count = liveSet.getcount("scenes");
    for (var i = 0; i < count; i++) {
        var s = new LiveAPI("live_set scenes " + i);
        sceneIdMap[parseInt(s.id)] = i;
    }
}

function getSelectedTrack() {
    try {
        var sel = viewAPI.get("selected_track");
        var str = sel.toString();
        var parts = str.split(",");
        if (parts.length >= 2) {
            var trackId = parseInt(parts[1]);
            if (trackIdMap[trackId] !== undefined) return trackIdMap[trackId];
        }
    } catch(e) {}
    return 0;
}

function getSelectedScene() {
    try {
        var sel = viewAPI.get("selected_scene");
        var str = sel.toString();
        var parts = str.split(",");
        if (parts.length >= 2) {
            var sceneId = parseInt(parts[1]);
            if (sceneIdMap[sceneId] !== undefined) return sceneIdMap[sceneId];
        }
    } catch(e) {}
    return 0;
}

function startPolling() {
    if (pollTask) pollTask.cancel();
    pollTask = new Task(pollCursor, this);
    pollTask.interval = 100; // 10Hz — safer than 15Hz
    pollTask.repeat();
    post("Cursor polling started.\n");
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

        if (t !== cursorTrack || s !== cursorScene) {
            cursorTrack = t;
            cursorScene = s;
            var name = (tracks[t] && tracks[t].name) ? tracks[t].name : "Track " + t;
            post(">> Cursor: Track " + t + " (" + name + ") Scene " + s + "\n");
            outlet(0, "cursor", t, name, s);

            if (connected) {
                var payload = JSON.stringify({
                    type: "state", user: userId,
                    track: t, scene: s, ts: Date.now()
                });
                outlet(1, payload);
            }
        }
    } catch(e) {
        post("pollCursor error: " + e + "\n");
    }
}

// Debug — call this to see raw API return values
function dbg() {
    post("\n=== DEBUG ===\n");
    try {
        var view = new LiveAPI("live_set view");
        var selTrack = view.get("selected_track");
        post("selected_track raw: " + selTrack + "\n");
        post("selected_track type: " + typeof selTrack + "\n");
        post("selected_track toString: " + selTrack.toString() + "\n");

        var selScene = view.get("selected_scene");
        post("selected_scene raw: " + selScene + "\n");

        var ls = new LiveAPI("live_set");
        var playing = ls.get("is_playing");
        post("is_playing raw: " + playing + "\n");
        post("is_playing type: " + typeof playing + "\n");

        var bpm = ls.get("tempo");
        post("tempo raw: " + bpm + "\n");

        post("pollTask running: " + (pollTask ? pollTask.running : "null") + "\n");
    } catch(e) {
        post("DEBUG ERROR: " + e + "\n");
    }
    post("=============\n");
}

function remote_set() {
    var a = arrayfromargs(arguments);
    if (a.length < 3) { post("Usage: remote_set <path> <prop> <value>\n"); return; }
    try {
        var api = new LiveAPI("live_set " + a[0]);
        api.set(a[1], a[2]);
        post("SET: " + a[0] + " " + a[1] + " = " + a[2] + "\n");
    } catch(e) { post("remote_set error: " + e + "\n"); }
}

function remote_launch() {
    var a = arrayfromargs(arguments);
    if (a.length < 2) { post("Usage: remote_launch <track> <scene>\n"); return; }
    try {
        var api = new LiveAPI("live_set tracks " + parseInt(a[0]) + " clip_slots " + parseInt(a[1]));
        api.call("fire");
        post("LAUNCH: Track " + a[0] + " Scene " + a[1] + "\n");
    } catch(e) { post("remote_launch error: " + e + "\n"); }
}

function refresh() {
    readTracks();
    post("Refreshed: " + tracks.length + " tracks\n");
}

function notifydeleted() {
    stopPolling();
    post("coLaB Hub destroyed.\n");
}

post("coLaB Hub v0.4.1 loaded.\n");

// coLaB Hub v0.4.3 – No Task object (uses metro in Max patcher instead)

var inlets = 1;
var outlets = 1;

var userId = 'user-' + Math.random().toString(36).substr(2, 6);
var tracks = [];
var cursorTrack = -1;
var cursorScene = -1;
var connected = false;
var partnerHost = "";
var ready = false;

function init() {
    post("coLaB Hub v0.4.3 initializing...\n");
    readTracks();
    ready = true;
    post("Ready. " + tracks.length + " tracks. Wire a [metro 100] → [poll] message → js for cursor tracking.\n");
}

function readTracks() {
    tracks = [];
    var ls = new LiveAPI("live_set");
    var count = ls.getcount("tracks");
    for (var i = 0; i < count; i++) {
        var t = new LiveAPI("live_set tracks " + i);
        var name = t.get("name").toString();
        tracks.push({ index: i, name: name, id: parseInt(t.id) });
        post("  Track " + i + ": " + name + "\n");
    }
}

// Called by [metro 100] → [message: poll] → js
function poll() {
    if (!ready) return;
    try {
        var view = new LiveAPI("live_set view");
        var sel = view.get("selected_track");
        var parts = sel.toString().split(",");
        var t = 0;
        if (parts.length >= 2) {
            var tid = parseInt(parts[1]);
            for (var i = 0; i < tracks.length; i++) {
                if (tracks[i].id === tid) { t = i; break; }
            }
        }

        var selS = view.get("selected_scene");
        var partsS = selS.toString().split(",");
        var s = 0;
        if (partsS.length >= 2) {
            var sid = parseInt(partsS[1]);
            // scene IDs are sequential, just use the number directly
            s = sid;
        }

        if (t !== cursorTrack || s !== cursorScene) {
            cursorTrack = t;
            cursorScene = s;
            var name = tracks[t] ? tracks[t].name : "Track " + t;
            post(">> Cursor: Track " + t + " (" + name + ") Scene " + s + "\n");

            if (connected) {
                outlet(0, JSON.stringify({
                    type: "state", user: userId,
                    track: t, scene: s, ts: Date.now()
                }));
            }
        }
    } catch(e) {}
}

function connect(ip) {
    partnerHost = ip.toString();
    connected = true;
    post("Connected to " + partnerHost + "\n");
}

function disconnect() {
    connected = false;
    partnerHost = "";
    post("Disconnected\n");
}

function incoming() {
    var a = arrayfromargs(arguments);
    var raw = a.join(" ");
    post(">>> INCOMING RAW: " + raw + "\n");
    try {
        var data = JSON.parse(raw);
        if (data.user === userId) return;

        if (data.type === "set") {
            var api = new LiveAPI("live_set " + data.path);
            api.set(data.prop, data.value);
            post("REMOTE " + data.user + ": set " + data.path + " " + data.prop + "=" + data.value + "\n");
        }
        else if (data.type === "launch") {
            var api2 = new LiveAPI("live_set tracks " + data.track + " clip_slots " + data.scene);
            api2.call("fire");
            post("REMOTE " + data.user + ": launch T" + data.track + " S" + data.scene + "\n");
        }
        else if (data.type === "state") {
            post("REMOTE " + data.user + ": cursor T" + data.track + " S" + data.scene + "\n");
        }
        else if (data.type === "transport") {
            var ls = new LiveAPI("live_set");
            if (data.action === "play") ls.call("start_playing");
            else if (data.action === "stop") ls.call("stop_playing");
            else if (data.action === "tempo") ls.set("tempo", data.value);
            post("REMOTE " + data.user + ": " + data.action + "\n");
        }
    } catch(e) {}
}

function remote_set() {
    var a = arrayfromargs(arguments);
    if (a.length < 3) { post("Usage: remote_set <path> <prop> <value>\n"); return; }
    try {
        var api = new LiveAPI("live_set " + a[0]);
        api.set(a[1], a[2]);
        post("SET: " + a[0] + " " + a[1] + " = " + a[2] + "\n");
        if (connected) outlet(0, JSON.stringify({ type: "set", user: userId, path: "" + a[0], prop: "" + a[1], value: a[2], ts: Date.now() }));
    } catch(e) { post("remote_set error: " + e + "\n"); }
}

function remote_launch() {
    var a = arrayfromargs(arguments);
    if (a.length < 2) return;
    try {
        var t = parseInt(a[0]); var s = parseInt(a[1]);
        var api = new LiveAPI("live_set tracks " + t + " clip_slots " + s);
        api.call("fire");
        post("LAUNCH: T" + t + " S" + s + "\n");
        if (connected) outlet(0, JSON.stringify({ type: "launch", user: userId, track: t, scene: s, ts: Date.now() }));
    } catch(e) { post("launch error: " + e + "\n"); }
}

function play() {
    try { new LiveAPI("live_set").call("start_playing"); post("PLAY\n"); } catch(e) {}
}

function stop() {
    try { new LiveAPI("live_set").call("stop_playing"); post("STOP\n"); } catch(e) {}
}

function settempo() {
    var a = arrayfromargs(arguments);
    if (a.length < 1) return;
    try { new LiveAPI("live_set").set("tempo", parseFloat(a[0])); post("TEMPO: " + a[0] + "\n"); } catch(e) {}
}

function refresh() { readTracks(); post("Refreshed.\n"); }

// Simple network test — sends plain text, not JSON
function testnet() {
    post("Sending test message...\n");
    outlet(0, "hello", "from", userId);
}

// Catch ANY message that arrives (debug)
function anything() {
    var name = messagename;
    var a = arrayfromargs(arguments);
    post("GOT MESSAGE: " + name + " " + a.join(" ") + "\n");
}

function dbg() {
    post("\n=== DEBUG ===\n");
    post("ready: " + ready + "\n");
    post("tracks: " + tracks.length + "\n");
    post("cursor: T" + cursorTrack + " S" + cursorScene + "\n");
    post("connected: " + connected + " partner: " + partnerHost + "\n");
    post("=============\n");
}

function notifydeleted() { ready = false; post("coLaB Hub destroyed.\n"); }

function save() { ready = false; }

post("coLaB Hub v0.4.3 loaded.\n");

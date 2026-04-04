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
    // Auto-connect to TheHAVEN with correct IP
    connect("192.168.0.83");
    post("Ready. " + tracks.length + " tracks. Auto-connected to 192.168.0.83.\n");
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
    // Update udpsend target — outlet 0 sends "host <ip>" which udpsend interprets
    outlet(0, "host", partnerHost);
    outlet(0, "port", 8001);
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
        else if (data.type === "sync" && data.diffs) {
            // From web-bridge param sync → apply each diff via LiveAPI
            for (var di = 0; di < data.diffs.length; di++) {
                var diff = data.diffs[di];
                if (diff.path && diff.prop !== undefined) {
                    try {
                        var api3 = new LiveAPI("live_set " + diff.path);
                        api3.set(diff.prop, diff.value);
                        post("SYNC " + diff.path + " " + diff.prop + "=" + diff.value + "\n");
                    } catch(e2) { post("SYNC ERR: " + e2 + "\n"); }
                }
            }
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
        else if (data.type === "sound") {
            // Partner wants to mute/unmute OUR session
            var ls2 = new LiveAPI("live_set");
            var tc = ls2.getcount("tracks");
            if (data.action === "on") {
                for (var si = 0; si < tc; si++) { new LiveAPI("live_set tracks " + si).set("mute", 0); }
                post("REMOTE " + data.user + ": unmuted our session\n");
            } else if (data.action === "off") {
                for (var si2 = 0; si2 < tc; si2++) { new LiveAPI("live_set tracks " + si2).set("mute", 1); }
                post("REMOTE " + data.user + ": muted our session\n");
            } else if (data.action === "toggle") {
                var m = parseInt(new LiveAPI("live_set tracks 0").get("mute"));
                for (var si3 = 0; si3 < tc; si3++) { new LiveAPI("live_set tracks " + si3).set("mute", m ? 0 : 1); }
                post("REMOTE " + data.user + ": toggled our session (" + (m ? "unmuted" : "muted") + ")\n");
            }
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

// Route UDP commands (udpreceive → prepend incoming → js)
function anything() {
    var name = messagename;
    var a = arrayfromargs(arguments);
    if (name === "incoming" || name === "/incoming") {
        var raw = a.join(" ");
        var cmd = raw.replace(/^\//, "");
        if (cmd === "poll") { poll(); return; }
        if (cmd === "init") { init(); return; }
        if (cmd === "refresh") { refresh(); return; }
        if (cmd === "sound_on") { sound_on(); return; }
        if (cmd === "sound_off") { sound_off(); return; }
        if (cmd === "sound_toggle") { sound_toggle(); return; }
        if (cmd.indexOf("connect ") === 0) { connect(cmd.substring(8)); return; }
        if (cmd === "disconnect") { disconnect(); return; }
        if (cmd.indexOf("notify ") === 0) { post("NOTIFY: " + cmd.substring(7) + "\n"); return; }
        if (raw.indexOf("{") >= 0) { incoming.apply(null, a); return; }
        post("CMD: " + cmd + "\n");
        return;
    }
    post("GOT: " + name + " " + a.join(" ") + "\n");
}

// Send sound on/off to PARTNER's session over the network
function sound_on() {
    if (!connected) { post("Not connected\n"); return; }
    outlet(0, JSON.stringify({ type: "sound", action: "on", user: userId, ts: Date.now() }));
    post(">> PARTNER SOUND ON\n");
}

function sound_off() {
    if (!connected) { post("Not connected\n"); return; }
    outlet(0, JSON.stringify({ type: "sound", action: "off", user: userId, ts: Date.now() }));
    post(">> PARTNER SOUND OFF\n");
}

function sound_toggle() {
    if (!connected) { post("Not connected\n"); return; }
    outlet(0, JSON.stringify({ type: "sound", action: "toggle", user: userId, ts: Date.now() }));
    post(">> PARTNER SOUND TOGGLE\n");
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

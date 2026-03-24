// coLaB Hub v0.5 – Synced Session State (Option C)
// Both machines open same project, changes sync bidirectionally
// Track params, clip state, transport all synchronized

var inlets = 1;
var outlets = 2; // outlet 0 → partner (udpsend), outlet 1 → web bridge (udpsend 127.0.0.1 8003)

var userId = 'user-' + Math.random().toString(36).substr(2, 6);
var connected = false;
var partnerHost = "";
var ready = false;

// State snapshots for change detection
var lastSnapshot = null;
var tracks = [];
var trackIdMap = {};
var suppressRemote = false; // prevent echo loops

function init() {
    post("coLaB Hub v0.5 – Synced Session\n");
    post("userId: " + userId + "\n");
    tracks = readAllTracks();
    lastSnapshot = takeSnapshot();
    ready = true;
    post("Ready. " + tracks.length + " tracks. Sync active.\n");
}

// === STATE SNAPSHOT ===

function readAllTracks() {
    var result = [];
    var ls = new LiveAPI("live_set");
    var count = ls.getcount("tracks");
    trackIdMap = {};
    for (var i = 0; i < count; i++) {
        var t = new LiveAPI("live_set tracks " + i);
        var tid = parseInt(t.id);
        var mixer = new LiveAPI("live_set tracks " + i + " mixer_device volume");
        var pan = new LiveAPI("live_set tracks " + i + " mixer_device panning");
        var info = {
            index: i,
            id: tid,
            name: t.get("name").toString(),
            mute: parseInt(t.get("mute")),
            solo: parseInt(t.get("solo")),
            arm: parseInt(t.get("arm")),
            volume: parseFloat(mixer.get("value")),
            pan: parseFloat(pan.get("value"))
        };
        result.push(info);
        trackIdMap[tid] = i;
        post("  Track " + i + ": " + info.name + "\n");
    }
    return result;
}

// LIGHTWEIGHT snapshot — only track params + transport, NO clips
function takeSnapshot() {
    var snap = {};
    var ls = new LiveAPI("live_set");
    var count = ls.getcount("tracks");
    for (var i = 0; i < count; i++) {
        var t = new LiveAPI("live_set tracks " + i);
        snap["t" + i] = {
            mute: parseInt(t.get("mute")),
            solo: parseInt(t.get("solo"))
        };
    }
    snap.transport = {
        playing: parseInt(ls.get("is_playing")),
        tempo: Math.round(parseFloat(ls.get("tempo")) * 100) / 100
    };
    return snap;
}

// === CHANGE DETECTION (called by metro) ===

function poll() {
    if (!ready || suppressRemote) return;

    try {
        var current = takeSnapshot();
        var diffs = findDiffs(lastSnapshot, current);

        if (diffs.length > 0) {
            lastSnapshot = current;

            // Log locally
            for (var i = 0; i < diffs.length; i++) {
                post(">> CHANGE: " + diffs[i].path + " = " + diffs[i].value + "\n");
            }

            // Send to partner + bridge
            if (connected) {
                var payload = JSON.stringify({
                    type: "sync",
                    user: userId,
                    diffs: diffs,
                    ts: Date.now()
                });
                outlet(0, payload); // → partner
                outlet(1, payload); // → web bridge
            }
        }

        // Also send cursor
        var view = new LiveAPI("live_set view");
        var selTrack = view.get("selected_track");
        var parts = selTrack.toString().split(",");
        var curTrack = 0;
        if (parts.length >= 2) {
            var tid = parseInt(parts[1]);
            if (trackIdMap[tid] !== undefined) curTrack = trackIdMap[tid];
        }

        if (connected) {
            var cursorMsg = JSON.stringify({
                type: "cursor",
                user: userId,
                track: curTrack,
                ts: Date.now()
            });
            outlet(0, cursorMsg); // → partner
            outlet(1, cursorMsg); // → web bridge
        }
    } catch(e) {
        // Silent fail to keep polling alive
    }
}

function findDiffs(old, current) {
    if (!old) return [];
    var diffs = [];

    // Compare tracks
    var ls = new LiveAPI("live_set");
    var count = ls.getcount("tracks");
    for (var i = 0; i < count; i++) {
        var key = "t" + i;
        if (!old[key] || !current[key]) continue;
        var o = old[key];
        var c = current[key];

        if (o.mute !== c.mute) diffs.push({ path: "tracks " + i, prop: "mute", value: c.mute });
        if (o.solo !== c.solo) diffs.push({ path: "tracks " + i, prop: "solo", value: c.solo });
    }

    // Transport
    if (old.transport && current.transport) {
        if (old.transport.playing !== current.transport.playing) {
            diffs.push({ path: "transport", prop: "playing", value: current.transport.playing });
        }
        if (Math.abs(old.transport.tempo - current.transport.tempo) > 0.1) {
            diffs.push({ path: "transport", prop: "tempo", value: current.transport.tempo });
        }
    }

    return diffs;
}

// === APPLY INCOMING CHANGES ===

function incoming() {
    var a = arrayfromargs(arguments);
    var raw = a.join(" ");
    post(">>> INCOMING: " + raw.substr(0, 80) + "\n");
    try {
        var data = JSON.parse(raw);
        if (data.user === userId) return;

        if (data.type === "sync" && data.diffs) {
            suppressRemote = true; // prevent echo
            for (var i = 0; i < data.diffs.length; i++) {
                var d = data.diffs[i];
                applyDiff(d);
            }
            // Update our snapshot so we don't re-broadcast these changes
            lastSnapshot = takeSnapshot();
            suppressRemote = false;
            post("APPLIED " + data.diffs.length + " changes from " + data.user + "\n");
            outlet(1, raw); // forward partner diffs to web bridge
        }
        else if (data.type === "cursor") {
            var name = (tracks[data.track] && tracks[data.track].name) ? tracks[data.track].name : "T" + data.track;
            post("PARTNER: " + name + "\n");
            outlet(1, raw); // forward partner cursor to web bridge
        }
    } catch(e) {
        suppressRemote = false;
        post("incoming error: " + e + "\n");
    }
}

function applyDiff(d) {
    try {
        if (d.path === "transport") {
            var ls = new LiveAPI("live_set");
            if (d.prop === "playing") {
                if (d.value) ls.call("start_playing");
                else ls.call("stop_playing");
            } else if (d.prop === "tempo") {
                ls.set("tempo", d.value);
            }
            post("  SYNC transport " + d.prop + " = " + d.value + "\n");
        }
        else if (d.prop === "fire") {
            var slot = new LiveAPI("live_set " + d.path);
            slot.call("fire");
            post("  SYNC fire " + d.path + "\n");
        }
        else if (d.prop === "clip_added" || d.prop === "clip_removed") {
            post("  SYNC " + d.prop + " at " + d.path + "\n");
            // Can't create/delete clips remotely yet — log only
        }
        else {
            var api = new LiveAPI("live_set " + d.path);
            api.set(d.prop, d.value);
            post("  SYNC " + d.path + " " + d.prop + " = " + d.value + "\n");
        }
    } catch(e) {
        post("  SYNC ERROR: " + d.path + " " + d.prop + " — " + e + "\n");
    }
}

// === COMMANDS ===

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

function refresh() {
    tracks = readAllTracks();
    lastSnapshot = takeSnapshot();
    post("Refreshed.\n");
}

function testnet() {
    post("Sending test...\n");
    outlet(0, "hello", "from", userId);
}

function anything() {
    var name = messagename;
    var a = arrayfromargs(arguments);
    post("GOT: " + name + " " + a.join(" ") + "\n");
}

function notifydeleted() { ready = false; post("coLaB Hub destroyed.\n"); }
function save() { ready = false; }

post("coLaB Hub v0.5 loaded.\n");

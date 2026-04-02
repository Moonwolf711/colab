// coLaB Hub v0.6 – Synced Session State + Activity Log + Recap
// Both machines open same project, changes sync bidirectionally
// Track params, clip state, transport all synchronized
// Activity logging + session recap on reconnect

var inlets = 1;
var outlets = 2; // outlet 0 → partner, outlet 1 → web bridge (:8003)

var userId = 'user-' + Math.random().toString(36).substr(2, 6);
var connected = false;
var partnerHost = "";
var partnerName = "";
var ready = false;
var myPatcher = null;
var overlayObj = null; // cached reference to v8ui cursor overlay
var panelObj = null;   // cached reference to v8ui control panel
var sharedDict = null; // Dict("colab_state") for cross-engine state

// State snapshots for change detection
var lastSnapshot = null;
var tracks = [];
var trackIdMap = {};
var suppressRemote = false; // prevent echo loops

// === ACTIVITY LOG ===
var activityLog = [];          // array of { ts, type, actor, data }
var activitySeq = 0;
var ACTIVITY_MAX = 2000;       // cap in-memory entries
var lastDisconnectTime = 0;
var sessionStartTime = 0;

// === TERMINAL HELPER ===

function sendToTerminal(prefix, msg) {
    try {
        if (typeof messnamed === 'function') {
            messnamed('claude_terminal_in', prefix + " " + msg);
        }
    } catch(e) {}
}

// === CURSOR VISUALIZATION ===
var localCursorTrack = -1;
var localCursorScene = -1;
var partnerCursorTrack = -1;
var partnerCursorScene = -1;
var lastLocalCursorTrack = -1;    // deduplicate
var lastPartnerCursorTrack = -1;  // deduplicate

function init() {
    post("coLaB Hub v0.6 – Synced Session + Activity Log\n");
    post("userId: " + userId + "\n");
    myPatcher = this.patcher;
    try { sharedDict = new Dict("colab_state"); post("Dict colab_state ready\n"); } catch(e) { post("Dict not available\n"); }
    findOverlay();
    findPanel();
    tracks = readAllTracks();
    lastSnapshot = takeSnapshot();
    sessionStartTime = Date.now();
    logActivity("session", "system", { event: "init", trackCount: tracks.length });
    sendTrackListToOverlay();
    sendTrackListToPanel();
    ready = true;
    post("Ready. " + tracks.length + " tracks. Sync + activity logging active.\n");
}

// Find the v8ui control panel in the patcher
function findPanel() {
    panelObj = null;
    if (!myPatcher) return;
    try {
        var obj = myPatcher.getnamed("colab_panel");
        if (obj) { panelObj = obj; post("findPanel: FOUND colab_panel\n"); return; }
    } catch(e) {}
    try {
        var obj = myPatcher.firstobject;
        while (obj) {
            var cls = obj.maxclass;
            if (cls === "v8ui" || cls === "jsui") {
                var fn = "";
                try { fn = obj.getattr("filename") || ""; } catch(e2) {}
                if (fn.indexOf("control-panel-ui") >= 0) {
                    panelObj = obj;
                    obj.varname = "colab_panel";
                    post("findPanel: FOUND by scan (" + cls + "), set varname\n");
                    return;
                }
            }
            obj = obj.nextobject;
        }
    } catch(e) {}
    post("findPanel: not found (add v8ui @filename control-panel-ui.js)\n");
}

// Push state to control panel + shared Dict
function pushState() {
    // Write to Dict for cross-engine reading
    if (sharedDict) {
        try {
            sharedDict.set("localTrack", localCursorTrack);
            sharedDict.set("localScene", localCursorScene);
            sharedDict.set("partnerTrack", partnerCursorTrack);
            sharedDict.set("partnerScene", partnerCursorScene);
            sharedDict.set("connected", connected ? 1 : 0);
            sharedDict.set("following", typeof followEnabled !== 'undefined' ? (followEnabled ? 1 : 0) : 0);
            sharedDict.set("cursorVisible", typeof cursorVisible !== 'undefined' ? (cursorVisible ? 1 : 0) : 1);
            sharedDict.set("trackCount", tracks.length);
        } catch(e) {}
    }
    // Also push via direct message to panel
    if (panelObj) {
        try {
            panelObj.message("cursor_local", localCursorTrack, localCursorScene);
            panelObj.message("cursor_partner", partnerCursorTrack, partnerCursorScene);
        } catch(e) {}
    }
}

function sendTrackListToPanel() {
    if (!panelObj) return;
    try {
        var args = ["tracks", tracks.length];
        for (var i = 0; i < tracks.length; i++) {
            args.push(tracks[i].name.replace(/ /g, "_"));
        }
        panelObj.message.apply(panelObj, args);
    } catch(e) {}
}

// Find the v8ui cursor overlay object in the patcher
function findOverlay() {
    overlayObj = null;
    if (!myPatcher) { post("findOverlay: no patcher ref\n"); return; }
    try {
        var obj = myPatcher.getnamed("cursor_overlay");
        if (obj) {
            overlayObj = obj;
            post("findOverlay: FOUND cursor_overlay (patcher.getnamed)\n");
            return;
        }
    } catch(e) {}
    // Scan all objects for v8ui with cursor-overlay-ui.js
    try {
        var obj = myPatcher.firstobject;
        while (obj) {
            var cls = obj.maxclass;
            if (cls === "v8ui" || cls === "jsui") {
                var fn = "";
                try { fn = obj.getattr("filename") || ""; } catch(e2) {}
                if (fn.indexOf("cursor-overlay") >= 0) {
                    overlayObj = obj;
                    obj.varname = "cursor_overlay";
                    post("findOverlay: FOUND by scan (" + cls + " " + fn + "), set varname\n");
                    return;
                }
            }
            obj = obj.nextobject;
        }
    } catch(e) {}
    post("findOverlay: NOT FOUND — will auto-create on setup()\n");
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

            // Log locally + activity log
            for (var i = 0; i < diffs.length; i++) {
                post(">> CHANGE: " + diffs[i].path + " = " + diffs[i].value + "\n");

                // Record in activity log
                if (diffs[i].path === "transport") {
                    logActivity("transport", "local", {
                        prop: diffs[i].prop,
                        oldVal: diffs[i].oldValue,
                        newVal: diffs[i].value
                    });
                } else {
                    var idx = parseInt(diffs[i].path.split(" ")[1]) || 0;
                    logActivity("track_param", "local", {
                        trackIdx: idx,
                        trackName: (tracks[idx] && tracks[idx].name) ? tracks[idx].name : "Track " + (idx + 1),
                        prop: diffs[i].prop,
                        oldVal: diffs[i].oldValue,
                        newVal: diffs[i].value
                    });
                }
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

        // Get selected scene
        var selScene = view.get("selected_scene");
        var sceneParts = selScene.toString().split(",");
        var curScene = 0;
        if (sceneParts.length >= 2) {
            curScene = parseInt(sceneParts[1]) || 0;
        }

        // Update local cursor + send to overlay JSUI
        localCursorTrack = curTrack;
        localCursorScene = curScene;
        if (curTrack !== lastLocalCursorTrack) {
            lastLocalCursorTrack = curTrack;
            if (cursorVisible) sendToOverlay("local", curTrack, curScene);
        }

        if (connected) {
            var cursorMsg = JSON.stringify({
                type: "cursor",
                user: userId,
                track: curTrack,
                scene: curScene,
                ts: Date.now()
            });
            outlet(0, cursorMsg); // → partner
            outlet(1, cursorMsg); // → web bridge
        }
        // Push state to control panel + Dict
        pushState();
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

        if (o.mute !== c.mute) diffs.push({ path: "tracks " + i, prop: "mute", value: c.mute, oldValue: o.mute });
        if (o.solo !== c.solo) diffs.push({ path: "tracks " + i, prop: "solo", value: c.solo, oldValue: o.solo });
    }

    // Transport
    if (old.transport && current.transport) {
        if (old.transport.playing !== current.transport.playing) {
            diffs.push({ path: "transport", prop: "playing", value: current.transport.playing, oldValue: old.transport.playing });
        }
        if (Math.abs(old.transport.tempo - current.transport.tempo) > 0.1) {
            diffs.push({ path: "transport", prop: "tempo", value: current.transport.tempo, oldValue: old.transport.tempo });
        }
    }

    return diffs;
}

// === ACTIVITY LOGGING ===

function logActivity(type, actor, data) {
    activityLog.push({
        id: activitySeq++,
        ts: Date.now(),
        type: type,     // 'track_param', 'transport', 'track_add', 'track_remove', 'session'
        actor: actor,   // 'local', 'partner', 'system'
        data: data
    });
    if (activityLog.length > ACTIVITY_MAX) activityLog.shift();
}

function getActivitySince(timestamp) {
    var result = [];
    for (var i = 0; i < activityLog.length; i++) {
        if (activityLog[i].ts >= timestamp) result.push(activityLog[i]);
    }
    return result;
}

// === RECAP GENERATOR ===

function generateRecap(entries) {
    if (!entries || entries.length === 0) return null;

    // Filter to partner-only changes
    var changes = [];
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].actor === 'partner') changes.push(entries[i]);
    }
    if (changes.length === 0) return null;

    var firstTs = changes[0].ts;
    var lastTs = changes[changes.length - 1].ts;
    var durationMin = Math.max(1, Math.round((lastTs - firstTs) / 60000));

    // Group changes by type
    var paramChanges = [];   // { trackIdx, prop, old, new }
    var transportChanges = [];
    var trackAdds = [];
    var trackRemoves = [];

    for (var j = 0; j < changes.length; j++) {
        var c = changes[j];
        var d = c.data;
        switch (c.type) {
            case 'track_param':
                // Collapse consecutive same-param changes
                var collapsed = false;
                for (var k = paramChanges.length - 1; k >= 0; k--) {
                    if (paramChanges[k].trackIdx === d.trackIdx && paramChanges[k].prop === d.prop) {
                        paramChanges[k].newVal = d.newVal;
                        collapsed = true;
                        break;
                    }
                }
                if (!collapsed) paramChanges.push({ trackIdx: d.trackIdx, trackName: d.trackName, prop: d.prop, oldVal: d.oldVal, newVal: d.newVal });
                break;
            case 'transport':
                // Collapse same-param transport changes
                var tCollapsed = false;
                for (var m = transportChanges.length - 1; m >= 0; m--) {
                    if (transportChanges[m].prop === d.prop) {
                        transportChanges[m].newVal = d.newVal;
                        tCollapsed = true;
                        break;
                    }
                }
                if (!tCollapsed) transportChanges.push({ prop: d.prop, oldVal: d.oldVal, newVal: d.newVal });
                break;
            case 'track_add':
                trackAdds.push(d.name || ("Track " + d.trackIdx));
                break;
            case 'track_remove':
                trackRemoves.push(d.name || ("Track " + d.trackIdx));
                break;
        }
    }

    // Build recap sections
    var sections = [];
    var textLines = [];

    textLines.push("SESSION RECAP");
    textLines.push("While you were away (" + durationMin + " min, " + formatTime(firstTs) + " - " + formatTime(lastTs) + "):");
    textLines.push("");

    if (trackAdds.length > 0 || trackRemoves.length > 0) {
        var trackItems = [];
        if (trackAdds.length > 0) {
            trackItems.push("+ Added " + trackAdds.length + " track" + (trackAdds.length > 1 ? "s" : "") + ': "' + trackAdds.join('", "') + '"');
        }
        if (trackRemoves.length > 0) {
            trackItems.push("- Removed " + trackRemoves.length + " track" + (trackRemoves.length > 1 ? "s" : "") + ': "' + trackRemoves.join('", "') + '"');
        }
        sections.push({ title: "Tracks", items: trackItems });
        for (var ti = 0; ti < trackItems.length; ti++) textLines.push(trackItems[ti]);
        textLines.push("");
    }

    if (paramChanges.length > 0) {
        var mixItems = [];
        for (var pi = 0; pi < paramChanges.length; pi++) {
            var pc = paramChanges[pi];
            var label = (pc.trackName || ("Track " + (pc.trackIdx + 1)));
            mixItems.push(formatParamChange(label, pc.prop, pc.oldVal, pc.newVal));
        }
        sections.push({ title: "Mix Changes", items: mixItems });
        for (var mi = 0; mi < mixItems.length; mi++) textLines.push(mixItems[mi]);
        textLines.push("");
    }

    if (transportChanges.length > 0) {
        var tItems = [];
        for (var xi = 0; xi < transportChanges.length; xi++) {
            var tc = transportChanges[xi];
            tItems.push(formatTransportChange(tc.prop, tc.oldVal, tc.newVal));
        }
        sections.push({ title: "Transport", items: tItems });
        for (var tl = 0; tl < tItems.length; tl++) textLines.push(tItems[tl]);
        textLines.push("");
    }

    var summary = {
        totalChanges: changes.length,
        tracksAffected: paramChanges.length + trackAdds.length,
        durationMin: durationMin,
        tracksAdded: trackAdds.length,
        paramChanges: paramChanges.length,
        timeRange: formatTime(firstTs) + " - " + formatTime(lastTs)
    };

    textLines.push("Summary: " + summary.totalChanges + " changes across " + summary.tracksAffected + " tracks in " + durationMin + " min");

    return { text: textLines.join("\n"), sections: sections, summary: summary };
}

function formatTime(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
}

function formatParamChange(trackLabel, prop, oldVal, newVal) {
    if (prop === "volume") return trackLabel + " volume: " + Math.round(oldVal * 100) + "% -> " + Math.round(newVal * 100) + "%";
    if (prop === "mute") return trackLabel + (newVal ? " muted" : " unmuted");
    if (prop === "solo") return trackLabel + (newVal ? " soloed" : " un-soloed");
    if (prop === "name") return trackLabel + ' renamed: "' + oldVal + '" -> "' + newVal + '"';
    return trackLabel + " " + prop + ": " + oldVal + " -> " + newVal;
}

function formatTransportChange(prop, oldVal, newVal) {
    if (prop === "tempo") return "Tempo: " + Math.round(oldVal) + " -> " + Math.round(newVal) + " BPM";
    if (prop === "playing") return newVal ? "Started playback" : "Stopped playback";
    return prop + ": " + oldVal + " -> " + newVal;
}

function deliverRecap(recap) {
    if (!recap) return;

    post("=== SESSION RECAP ===\n");
    var lines = recap.text.split("\n");
    for (var i = 0; i < lines.length; i++) {
        post("  " + lines[i] + "\n");
    }

    // Send to Claude Terminal via outlet 2
    sendToTerminal("[SYS]", "=== SESSION RECAP ===");
    for (var j = 0; j < lines.length; j++) {
        if (lines[j].trim()) {
            var prefix = "[INFO]";
            if (lines[j].indexOf("+") === 0) prefix = "[NOTE]";
            else if (lines[j].indexOf("-") === 0) prefix = "[WARN]";
            else if (lines[j].indexOf("Summary") === 0) prefix = "[SYS]";
            else if (lines[j].indexOf("SESSION") === 0 || lines[j].indexOf("While") === 0) prefix = "[SYS]";
            sendToTerminal(prefix, lines[j]);
        }
    }
    sendToTerminal("[SYS]", "=== END RECAP ===");

    // Also send to web bridge
    var payload = JSON.stringify({ type: "recap", user: userId, recap: recap });
    outlet(1, payload);
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

                // Log partner activity
                if (d.path === "transport") {
                    logActivity("transport", "partner", {
                        prop: d.prop,
                        oldVal: d.oldValue || null,
                        newVal: d.value
                    });
                } else {
                    var idx = parseInt(d.path.split(" ")[1]) || 0;
                    logActivity("track_param", "partner", {
                        trackIdx: idx,
                        trackName: (tracks[idx] && tracks[idx].name) ? tracks[idx].name : "Track " + (idx + 1),
                        prop: d.prop,
                        oldVal: d.oldValue || null,
                        newVal: d.value
                    });
                }
            }
            // Update our snapshot so we don't re-broadcast these changes
            lastSnapshot = takeSnapshot();
            suppressRemote = false;
            post("APPLIED " + data.diffs.length + " changes from " + data.user + "\n");
            outlet(1, raw); // forward partner diffs to web bridge
        }
        else if (data.type === "cursor") {
            var pTrack = parseInt(data.track) || 0;
            var pScene = parseInt(data.scene) || 0;
            var name = (tracks[pTrack] && tracks[pTrack].name) ? tracks[pTrack].name : "T" + pTrack;
            post("PARTNER: " + name + "\n");

            // Update partner cursor + overlay
            partnerCursorTrack = pTrack;
            partnerCursorScene = pScene;
            if (cursorVisible) sendToOverlay("partner", pTrack, pScene);
            doFollowPartner(pTrack, pScene);

            lastPartnerCursorTrack = pTrack;

            outlet(1, raw); // forward partner cursor to web bridge
        }
        // Engine connect/disconnect notifications from web-bridge
        else if (data.type === "engine_connect") {
            if (!connected) {
                connect(data.partner || "engine");
            }
            post("ENGINE: peer connected via engine — " + (data.partner || "unknown") + "\n");
        }
        else if (data.type === "engine_disconnect") {
            if (connected) {
                disconnect();
            }
            post("ENGINE: peer disconnected — " + (data.reason || "unknown") + "\n");
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

// === CURSOR VISUALIZATION ===

// Send cursor position to the overlay via patcher.getnamed (cross-engine compatible)
function sendToOverlay(who, trackIdx, sceneIdx) {
    try {
        // Method 1: cached patcher reference (works cross-engine js→v8ui)
        if (overlayObj) {
            overlayObj.message(who, parseInt(trackIdx), parseInt(sceneIdx));
            return;
        }
        // Method 2: re-find it
        if (myPatcher) {
            findOverlay();
            if (overlayObj) {
                overlayObj.message(who, parseInt(trackIdx), parseInt(sceneIdx));
                return;
            }
        }
        // Method 3: messnamed fallback (same-engine only)
        if (typeof messnamed === 'function') {
            messnamed('cursor_overlay', who, trackIdx, sceneIdx);
        }
    } catch(e) {}
}

// Update the overlay with current track list (call after init/refresh)
function sendTrackListToOverlay() {
    try {
        if (overlayObj) {
            // Send track count + names
            var args = ['tracks', tracks.length];
            for (var i = 0; i < tracks.length; i++) {
                args.push(tracks[i].name.replace(/ /g, '_'));
            }
            overlayObj.message.apply(overlayObj, args);

            var ls = new LiveAPI("live_set");
            var scenes = ls.getcount("scenes");
            overlayObj.message('scenes', scenes);
            post("Sent " + tracks.length + " tracks + " + scenes + " scenes to overlay\n");
            return;
        }
        // fallback to messnamed
        if (typeof messnamed !== 'function') return;
        var args2 = ['cursor_overlay', 'tracks', tracks.length];
        for (var j = 0; j < tracks.length; j++) {
            args2.push(tracks[j].name.replace(/ /g, '_'));
        }
        messnamed.apply(null, args2);
        var ls2 = new LiveAPI("live_set");
        var scenes2 = ls2.getcount("scenes");
        messnamed('cursor_overlay', 'scenes', scenes2);
    } catch(e) {}
}


// === COMMANDS ===

function connect(ip) {
    var wasDisconnected = !connected;
    partnerHost = ip.toString();
    connected = true;
    post("Connected to " + partnerHost + "\n");
    logActivity("session", "system", { event: "connected", partner: partnerHost });
    try { if (overlayObj) overlayObj.message('partner_name', partnerHost); else if (typeof messnamed === 'function') messnamed('cursor_overlay', 'partner_name', partnerHost); } catch(e) {}

    // On reconnect — generate and deliver recap
    if (wasDisconnected && lastDisconnectTime > 0) {
        var entries = getActivitySince(lastDisconnectTime);
        var recap = generateRecap(entries);
        if (recap) {
            deliverRecap(recap);
        }
        lastDisconnectTime = 0;
    }

    if (sessionStartTime === 0) sessionStartTime = Date.now();
}

function disconnect() {
    lastDisconnectTime = Date.now();
    connected = false;
    partnerHost = "";
    lastPartnerCursorTrack = -1;
    partnerCursorTrack = -1;
    partnerCursorScene = -1;
    logActivity("session", "system", { event: "disconnected" });
    try { if (overlayObj) overlayObj.message('partner_offline'); else if (typeof messnamed === 'function') messnamed('cursor_overlay', 'partner_offline'); } catch(e) {}
    post("Disconnected\n");
}

function refresh() {
    tracks = readAllTracks();
    lastSnapshot = takeSnapshot();
    sendTrackListToOverlay();
    post("Refreshed.\n");
}

function testnet() {
    post("Sending test...\n");
    outlet(0, "hello", "from", userId);
}

function anything() {
    var name = messagename;
    var a = arrayfromargs(arguments);
    var msg = name + " " + a.join(" ");

    // === CLAUDE TERMINAL ===
    // Messages prefixed with [CMD], [OSC], [PARAM], [NOTE], [ERR], [WARN], [SYS], [INFO]
    // get logged to the Max console with color-coded prefixes
    if (msg.indexOf("[CMD]") === 0 || msg.indexOf("[OSC]") === 0 ||
        msg.indexOf("[PARAM]") === 0 || msg.indexOf("[NOTE]") === 0 ||
        msg.indexOf("[ERR]") === 0 || msg.indexOf("[WARN]") === 0 ||
        msg.indexOf("[SYS]") === 0 || msg.indexOf("[INFO]") === 0) {
        var ts = new Date();
        var timeStr = pad2(ts.getHours()) + ":" + pad2(ts.getMinutes()) + ":" + pad2(ts.getSeconds());
        post("[" + timeStr + "] " + msg + "\n");
        return;
    }

    // Messages starting with /live/ are OSC-style commands to execute
    if (msg.indexOf("/live/") === 0) {
        post("[CLAUDE-OSC] " + msg + "\n");
        handleClaudeOSC(msg);
        return;
    }

    // OSC /incoming — route to incoming() handler (strip address prefix)
    if (name === "/incoming" || name === "incoming") {
        incoming.apply(null, a);
        return;
    }

    // Try to parse as JSON directly (raw UDP without OSC address)
    if (msg.indexOf("{") >= 0) {
        var jsonStart = msg.indexOf("{");
        try {
            var parsed = JSON.parse(msg.substring(jsonStart));
            incoming.apply(null, [msg.substring(jsonStart)]);
            return;
        } catch(e) {}
    }

    post("GOT: " + msg + "\n");
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

// === CLAUDE OSC HANDLER ===
// Execute LiveAPI commands sent from Claude via UDP

function handleClaudeOSC(msg) {
    var parts = msg.split(" ");
    var address = parts[0];
    var args = parts.slice(1);

    try {
        // Transport
        if (address === "/live/song/start_playing") {
            var ls = new LiveAPI("live_set"); ls.call("start_playing");
            post("  >> PLAY\n");
        }
        else if (address === "/live/song/stop_playing") {
            var ls = new LiveAPI("live_set"); ls.call("stop_playing");
            post("  >> STOP\n");
        }
        else if (address === "/live/song/set/tempo" && args.length >= 1) {
            var ls = new LiveAPI("live_set"); ls.set("tempo", parseFloat(args[0]));
            post("  >> TEMPO " + args[0] + "\n");
        }
        else if (address === "/live/song/set/metronome" && args.length >= 1) {
            var ls = new LiveAPI("live_set"); ls.set("metronome", parseInt(args[0]));
            post("  >> METRONOME " + args[0] + "\n");
        }
        else if (address === "/live/song/set/record_mode" && args.length >= 1) {
            var ls = new LiveAPI("live_set"); ls.set("record_mode", parseInt(args[0]));
            post("  >> RECORD " + args[0] + "\n");
        }
        else if (address === "/live/song/set/loop" && args.length >= 1) {
            var ls = new LiveAPI("live_set"); ls.set("loop", parseInt(args[0]));
            post("  >> LOOP " + args[0] + "\n");
        }
        else if (address === "/live/song/undo") {
            var ls = new LiveAPI("live_set"); ls.call("undo");
            post("  >> UNDO\n");
        }
        else if (address === "/live/song/redo") {
            var ls = new LiveAPI("live_set"); ls.call("redo");
            post("  >> REDO\n");
        }
        // Track params
        else if (address === "/live/track/set/volume" && args.length >= 2) {
            var mixer = new LiveAPI("live_set tracks " + args[0] + " mixer_device volume");
            mixer.set("value", parseFloat(args[1]));
            post("  >> TRACK " + args[0] + " VOL " + args[1] + "\n");
        }
        else if (address === "/live/track/set/panning" && args.length >= 2) {
            var pan = new LiveAPI("live_set tracks " + args[0] + " mixer_device panning");
            pan.set("value", parseFloat(args[1]));
            post("  >> TRACK " + args[0] + " PAN " + args[1] + "\n");
        }
        else if (address === "/live/track/set/mute" && args.length >= 2) {
            var t = new LiveAPI("live_set tracks " + args[0]);
            t.set("mute", parseInt(args[1]));
            post("  >> TRACK " + args[0] + " MUTE " + args[1] + "\n");
        }
        else if (address === "/live/track/set/solo" && args.length >= 2) {
            var t = new LiveAPI("live_set tracks " + args[0]);
            t.set("solo", parseInt(args[1]));
            post("  >> TRACK " + args[0] + " SOLO " + args[1] + "\n");
        }
        else if (address === "/live/track/set/arm" && args.length >= 2) {
            var t = new LiveAPI("live_set tracks " + args[0]);
            t.set("arm", parseInt(args[1]));
            post("  >> TRACK " + args[0] + " ARM " + args[1] + "\n");
        }
        // Clip control
        else if (address === "/live/clip/fire" && args.length >= 2) {
            var slot = new LiveAPI("live_set tracks " + args[0] + " clip_slots " + args[1] + " clip");
            slot.call("fire");
            post("  >> FIRE CLIP " + args[0] + "/" + args[1] + "\n");
        }
        else if (address === "/live/clip/stop" && args.length >= 2) {
            var slot = new LiveAPI("live_set tracks " + args[0] + " clip_slots " + args[1] + " clip");
            slot.call("stop");
            post("  >> STOP CLIP " + args[0] + "/" + args[1] + "\n");
        }
        // Scene
        else if (address === "/live/scene/fire" && args.length >= 1) {
            var scene = new LiveAPI("live_set scenes " + args[0]);
            scene.call("fire");
            post("  >> FIRE SCENE " + args[0] + "\n");
        }
        // Device params
        else if (address === "/live/device/set/parameter/value" && args.length >= 4) {
            var param = new LiveAPI("live_set tracks " + args[0] + " devices " + args[1] + " parameters " + args[2]);
            param.set("value", parseFloat(args[3]));
            post("  >> DEVICE " + args[0] + "/" + args[1] + " PARAM " + args[2] + " = " + args[3] + "\n");
        }
        // Get info
        else if (address === "/live/song/get/tempo") {
            var ls = new LiveAPI("live_set");
            post("  << TEMPO: " + ls.get("tempo") + "\n");
        }
        else if (address === "/live/song/get/is_playing") {
            var ls = new LiveAPI("live_set");
            post("  << PLAYING: " + ls.get("is_playing") + "\n");
        }
        else if (address === "/live/tracks/get/count") {
            var ls = new LiveAPI("live_set");
            post("  << TRACKS: " + ls.getcount("tracks") + "\n");
        }
        else {
            post("  ?? UNKNOWN: " + address + "\n");
        }
    } catch(e) {
        post("  !! ERROR: " + address + " — " + e + "\n");
    }
}

// === PATCHER SETUP (creates + wires cursor overlay) ===

function setup() {
    post("=== SETUP: Cursor Overlay + Control Panel ===\n");
    try {
        var p = myPatcher || this.patcher;
        myPatcher = p;
        if (!sharedDict) { try { sharedDict = new Dict("colab_state"); } catch(e3) {} }

        // --- CURSOR OVERLAY ---
        findOverlay();
        if (!overlayObj) {
            try {
                var old = p.getnamed("cursor_overlay");
                if (old) { p.remove(old); post("  Removed old overlay\n"); }
            } catch(e2) {}
            var overlay = p.newdefault(600, 50, "v8ui",
                "@filename", "cursor-overlay-ui.js",
                "@size", 400, 280,
                "@presentation", 1,
                "@presentation_rect", 0, 0, 400, 280
            );
            overlay.varname = "cursor_overlay";
            overlayObj = overlay;
            post("  Created cursor_overlay\n");
        } else {
            post("  cursor_overlay exists\n");
        }
        overlayObj.message("local", 0, 0);
        overlayObj.message("partner", 2, 1);

        // --- CONTROL PANEL ---
        findPanel();
        if (!panelObj) {
            try {
                var oldP = p.getnamed("colab_panel");
                if (oldP) { p.remove(oldP); }
            } catch(e4) {}
            var panel = p.newdefault(600, 350, "v8ui",
                "@filename", "control-panel-ui.js",
                "@size", 460, 230,
                "@presentation", 1,
                "@presentation_rect", 0, 280, 460, 230
            );
            panel.varname = "colab_panel";
            panelObj = panel;
            post("  Created control panel\n");
        } else {
            post("  control panel exists\n");
        }
        sendTrackListToPanel();

        post("=== SETUP COMPLETE ===\n");
    } catch(e) {
        post("Setup error: " + e + "\n");
    }
}

// Test overlay communication explicitly
function test_overlay() {
    post("=== TEST OVERLAY ===\n");
    if (!myPatcher) { myPatcher = this.patcher; }
    findOverlay();
    if (overlayObj) {
        post("  overlayObj found: " + overlayObj.maxclass + "\n");
        overlayObj.message("local", 1, 0);
        overlayObj.message("partner", 3, 2);
        overlayObj.message("tracks", 4, "Drums", "Bass", "Synth", "Vocals");
        overlayObj.message("scenes", 6);
        post("  Sent test data to overlay via patcher ref\n");
    } else {
        post("  NO overlay found! Run setup first.\n");
        // Try messnamed as last resort
        try {
            messnamed("cursor_overlay", "local", 1, 0);
            post("  Tried messnamed fallback\n");
        } catch(e) { post("  messnamed also failed: " + e + "\n"); }
    }
    post("=== END TEST ===\n");
}

// === SOUND TOGGLE ===

function sound_on() {
    try {
        var ls = new LiveAPI("live_set");
        var count = ls.getcount("tracks");
        for (var i = 0; i < count; i++) {
            var t = new LiveAPI("live_set tracks " + i);
            t.set("mute", 0);
        }
        post("SOUND ON: All " + count + " tracks unmuted\n");
        sendToTerminal("[CMD]", "Sound ON - all tracks unmuted");
    } catch(e) { post("sound_on error: " + e + "\n"); }
}

function sound_off() {
    try {
        var ls = new LiveAPI("live_set");
        var count = ls.getcount("tracks");
        for (var i = 0; i < count; i++) {
            var t = new LiveAPI("live_set tracks " + i);
            t.set("mute", 1);
        }
        post("SOUND OFF: All " + count + " tracks muted\n");
        sendToTerminal("[CMD]", "Sound OFF - all tracks muted");
    } catch(e) { post("sound_off error: " + e + "\n"); }
}

function sound_toggle() {
    try {
        var ls = new LiveAPI("live_set");
        var t0 = new LiveAPI("live_set tracks 0");
        var isMuted = parseInt(t0.get("mute"));
        if (isMuted) { sound_on(); } else { sound_off(); }
    } catch(e) { post("sound_toggle error: " + e + "\n"); }
}

// === FOLLOW CURSOR ===
var followEnabled = false;

function follow_cursor() {
    var a = arrayfromargs(arguments);
    var val = (a.length > 0) ? parseInt(a[0]) : -1;
    if (val === -1) followEnabled = !followEnabled;
    else followEnabled = !!val;
    post("Follow cursor: " + (followEnabled ? "ON" : "OFF") + "\n");
    sendToTerminal("[CMD]", "Follow cursor " + (followEnabled ? "ON" : "OFF"));
}

// Called from poll() when following is enabled and partner moves
function doFollowPartner(trackIdx, sceneIdx) {
    if (!followEnabled) return;
    try {
        var ls = new LiveAPI("live_set");
        var count = ls.getcount("tracks");
        if (trackIdx >= 0 && trackIdx < count) {
            var t = new LiveAPI("live_set tracks " + trackIdx);
            var view = new LiveAPI("live_set view");
            view.set("selected_track", "live_set tracks " + trackIdx);
            post("FOLLOWED partner to track " + trackIdx + "\n");
        }
    } catch(e) { post("follow error: " + e + "\n"); }
}

// === CURSOR VISIBILITY ===
var cursorVisible = true;

function show_cursor() {
    cursorVisible = true;
    if (overlayObj) {
        try { overlayObj.message("visibility", 1); } catch(e) {}
    }
    post("Cursor overlay: VISIBLE\n");
}

function hide_cursor() {
    cursorVisible = false;
    if (overlayObj) {
        try { overlayObj.message("visibility", 0); } catch(e) {}
    }
    post("Cursor overlay: HIDDEN\n");
}

// === NOTIFY PARTNER ===

function notify() {
    var a = arrayfromargs(arguments);
    var text = a.join(" ");
    if (!text) text = "Hey!";
    post("NOTIFY >> " + text + "\n");
    sendToTerminal("[NOTE]", "You notified: " + text);
    if (connected) {
        var payload = JSON.stringify({
            type: "notify",
            user: userId,
            text: text,
            ts: Date.now()
        });
        outlet(0, payload);
        outlet(1, payload);
    }
    // Show locally too
    if (overlayObj) {
        try { overlayObj.message("notification", text); } catch(e) {}
    }
}

// === STATUS FOR WEB PANEL ===

function get_status() {
    var status = {
        type: "status",
        userId: userId,
        connected: connected,
        partnerHost: partnerHost,
        partnerName: partnerName,
        trackCount: tracks.length,
        localTrack: localCursorTrack,
        localScene: localCursorScene,
        partnerTrack: partnerCursorTrack,
        partnerScene: partnerCursorScene,
        following: followEnabled,
        cursorVisible: cursorVisible,
        tracks: []
    };
    for (var i = 0; i < tracks.length; i++) {
        status.tracks.push({
            index: i,
            name: tracks[i].name,
            mute: tracks[i].mute
        });
    }
    var payload = JSON.stringify(status);
    outlet(1, payload); // send to web bridge
    post("Status sent\n");
}

function notifydeleted() { ready = false; post("coLaB Hub destroyed.\n"); }
function save() { ready = false; }

// Add manual recap command
function recap() {
    if (activityLog.length === 0) {
        post("No activity recorded yet.\n");
        sendToTerminal("[SYS]", "No activity recorded yet.");
        return;
    }
    var recap = generateRecap(activityLog);
    if (recap) {
        deliverRecap(recap);
    } else {
        post("No partner changes to recap.\n");
        sendToTerminal("[SYS]", "No partner changes to recap.");
    }
}

// Show activity log stats
function logstats() {
    var partner = 0;
    var local = 0;
    for (var i = 0; i < activityLog.length; i++) {
        if (activityLog[i].actor === "partner") partner++;
        else if (activityLog[i].actor === "local") local++;
    }
    post("Activity log: " + activityLog.length + " entries (" + local + " local, " + partner + " partner)\n");
    if (sessionStartTime > 0) {
        var mins = Math.round((Date.now() - sessionStartTime) / 60000);
        post("Session duration: " + mins + " min\n");
    }
}

post("coLaB Hub v0.6 + Activity Log + Claude Terminal loaded.\n");

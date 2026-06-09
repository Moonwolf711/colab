// skallywag_live.js — executes Skallywag agent actions inside Ableton via LiveAPI.
// In  (from jweb):  ["act", op, arg1, arg2, ...]   (legacy ["cursor", kind, i, j] still ok)
//                   ["act", "query", id, kind, args...]  -> reads Live, returns result
// Out (outlet 0 -> jweb -> agent):  ["qresult", id, <hex(JSON)>]
// Safe, scoped Ableton control only — no shell/file access.

autowatch = 1;
inlets = 1;
outlets = 1; // outlet 0: query results back toward the UI/agent

function log(s) { post("[skallywag] " + s + "\n"); }
function api(path) { return new LiveAPI(null, path); }
function g(a, k) { try { var v = a.get(k); return (v && v.length) ? v[0] : v; } catch (e) { return null; } }
function gc(a, k) { try { return a.getcount(k); } catch (e) { return 0; } }

// ── hex(JSON) so query results survive Max's atom tokenizer ──
function hexEncode(s) {
  var u = unescape(encodeURIComponent(String(s))), h = "", i, c;
  for (i = 0; i < u.length; i++) { c = u.charCodeAt(i).toString(16); h += (c.length < 2 ? "0" + c : c); }
  return h;
}
function reply(id, obj) { outlet(0, "qresult", id, hexEncode(JSON.stringify(obj))); }

// ───────────────────────── writes ─────────────────────────
function transport(action) {
  var s = api("live_set");
  switch (String(action)) {
    case "play": s.call("start_playing"); break;
    case "continue": s.call("continue_playing"); break;
    case "stop": s.call("stop_playing"); break;
    case "record": s.set("session_record", g(s, "session_record") ? 0 : 1); break;
    default: log("transport? " + action);
  }
}
function setTempo(b)        { api("live_set").set("tempo", parseFloat(b)); }
function setMetro(on)       { api("live_set").set("metronome", parseInt(on, 10) ? 1 : 0); }
function setLoop(on, sb, lb) {
  var s = api("live_set"); s.set("loop", parseInt(on, 10) ? 1 : 0);
  if (parseFloat(lb) > 0) { s.set("loop_start", parseFloat(sb) * 4); s.set("loop_length", parseFloat(lb) * 4); }
}
function setTimeSig(n, d)   { var s = api("live_set"); s.set("signature_numerator", parseInt(n, 10)); s.set("signature_denominator", parseInt(d, 10)); }
function captureMidi()      { api("live_set").call("capture_midi"); }

function selectTrack(i)     { var t = api("live_set tracks " + i); if (t && t.id) api("live_set view").set("selected_track", "id " + t.id); }
function createTrack(kind, idx) {
  var s = api("live_set"), i = parseInt(idx, 10); if (!(i >= 0)) i = gc(s, kind === "audio" ? "tracks" : "tracks");
  if (kind === "audio") s.call("create_audio_track", i);
  else if (kind === "return") s.call("create_return_track");
  else s.call("create_midi_track", i);
}
function deleteTrack(i)     { api("live_set").call("delete_track", parseInt(i, 10)); }
function renameTrack(i, n)  { api("live_set tracks " + i).set("name", String(n).replace(/_/g, " ")); }
function trackColor(i, c)   { api("live_set tracks " + i).set("color_index", parseInt(c, 10)); }

function setVolume(t, v)    { api("live_set tracks " + t + " mixer_device volume").set("value", parseFloat(v)); }
function setPan(t, v)       { api("live_set tracks " + t + " mixer_device panning").set("value", parseFloat(v)); }
function setMute(t, on)     { api("live_set tracks " + t).set("mute", parseInt(on, 10) ? 1 : 0); }
function setSolo(t, on)     { api("live_set tracks " + t).set("solo", parseInt(on, 10) ? 1 : 0); }
function setArm(t, on)      { api("live_set tracks " + t).set("arm", parseInt(on, 10) ? 1 : 0); }
function setSend(t, s, v)   { api("live_set tracks " + t + " mixer_device sends " + s).set("value", parseFloat(v)); }

function slot(t, s)         { return api("live_set tracks " + t + " clip_slots " + s); }
function selectClip(t, s)   { var v = api("live_set view"), tr = api("live_set tracks " + t); if (tr && tr.id) v.set("selected_track", "id " + tr.id); var cs = slot(t, s); if (cs && cs.id) v.set("highlighted_clip_slot", "id " + cs.id); }
function fireClip(t, s)     { var cs = slot(t, s); if (cs && cs.id) cs.call("fire"); }
function stopClip(t)        { api("live_set tracks " + t).call("stop_all_clips"); }
function createClip(t, s, bars) { var cs = slot(t, s); if (cs && cs.id && !g(cs, "has_clip")) cs.call("create_clip", parseFloat(bars) * 4); }
function deleteClip(t, s)   { var cs = slot(t, s); if (cs && cs.id && g(cs, "has_clip")) cs.call("delete_clip"); }
function clipLen(t, s, bars) {
  var c = api("live_set tracks " + t + " clip_slots " + s + " clip"); if (!c || !c.id) return;
  var beats = parseFloat(bars) * 4; c.set("loop_start", 0); c.set("loop_end", beats); c.set("end_marker", beats);
}
function clipName(t, s, n)  { var c = api("live_set tracks " + t + " clip_slots " + s + " clip"); if (c && c.id) c.set("name", String(n).replace(/_/g, " ")); }
function quantizeClip(t, s, grid) { var c = api("live_set tracks " + t + " clip_slots " + s + " clip"); if (c && c.id) c.call("quantize", parseInt(grid, 10), 1.0); }

function addNotes(t, s, noteToks) {
  var cs = slot(t, s); if (!cs || !cs.id) { log("addNotes: no slot " + t + "/" + s); return; }
  // parse "pitch:start:dur:vel" tokens, find span, ensure a clip exists
  var notes = [], i, p, maxEnd = 0;
  for (i = 0; i < noteToks.length; i++) {
    var f = String(noteToks[i]).split(":");
    p = { pitch: parseInt(f[0], 10), start: parseFloat(f[1]), dur: parseFloat(f[2]), vel: parseInt(f[3], 10) || 100 };
    if (isNaN(p.pitch)) continue;
    notes.push(p); if (p.start + p.dur > maxEnd) maxEnd = p.start + p.dur;
  }
  if (!notes.length) return;
  if (!g(cs, "has_clip")) { var bars = Math.max(1, Math.ceil(maxEnd / 4)); cs.call("create_clip", bars * 4); }
  var c = api("live_set tracks " + t + " clip_slots " + s + " clip"); if (!c || !c.id) return;
  c.call("set_notes"); c.call("notes", notes.length);
  for (i = 0; i < notes.length; i++) c.call("note", notes[i].pitch, notes[i].start, notes[i].dur, notes[i].vel, 0);
  c.call("done");
  log("added " + notes.length + " notes -> " + t + "/" + s);
}
function clearNotes(t, s)   { var c = api("live_set tracks " + t + " clip_slots " + s + " clip"); if (c && c.id) c.call("remove_notes_extended", 0, 128, 0, 1000000); }

function deviceParam(t, d, p, norm) {
  var pa = api("live_set tracks " + t + " devices " + d + " parameters " + p); if (!pa || !pa.id) return;
  var mn = parseFloat(g(pa, "min")), mx = parseFloat(g(pa, "max"));
  pa.set("value", mn + Math.max(0, Math.min(1, parseFloat(norm))) * (mx - mn));
}
function deviceOn(t, d, on)  { var dv = api("live_set tracks " + t + " devices " + d); if (dv && dv.id) dv.set("is_active", parseInt(on, 10) ? 1 : 0); }

function selectScene(i)     { var sc = api("live_set scenes " + i); if (sc && sc.id) api("live_set view").set("selected_scene", "id " + sc.id); }
function fireScene(i)       { var sc = api("live_set scenes " + i); if (sc && sc.id) sc.call("fire"); }
function createScene(idx)   { var i = parseInt(idx, 10); api("live_set").call("create_scene", (i >= 0 ? i : -1)); }
function deleteScene(i)     { api("live_set").call("delete_scene", parseInt(i, 10)); }

// ───────────────────────── queries (return data to agent) ─────────────────────────
function qOverview(id) {
  var s = api("live_set"), n = gc(s, "tracks"), tracks = [], i, max = Math.min(n, 48);
  for (i = 0; i < max; i++) {
    var t = api("live_set tracks " + i);
    tracks.push({ i: i, name: g(t, "name"), type: g(t, "has_midi_input") ? "midi" : "audio", devices: gc(t, "devices") });
  }
  reply(id, { tempo: g(s, "tempo"), playing: g(s, "is_playing"), tracks: tracks, scenes: gc(s, "scenes") });
}
function qDevices(id, t) {
  var tr = api("live_set tracks " + t), n = gc(tr, "devices"), out = [], i;
  for (i = 0; i < n; i++) { var d = api("live_set tracks " + t + " devices " + i); out.push({ i: i, name: g(d, "name"), cls: g(d, "class_name") }); }
  reply(id, { track: parseInt(t, 10), devices: out });
}
function qParams(id, t, d) {
  var dv = api("live_set tracks " + t + " devices " + d), n = Math.min(gc(dv, "parameters"), 64), out = [], i;
  for (i = 0; i < n; i++) {
    var pa = api("live_set tracks " + t + " devices " + d + " parameters " + i);
    out.push({ i: i, name: g(pa, "name"), val: g(pa, "value"), min: g(pa, "min"), max: g(pa, "max") });
  }
  reply(id, { track: parseInt(t, 10), device: parseInt(d, 10), name: g(dv, "name"), params: out });
}
function qClip(id, t, s) {
  var cs = slot(t, s);
  if (!cs || !cs.id || !g(cs, "has_clip")) { reply(id, { track: +t, slot: +s, empty: true }); return; }
  var c = api("live_set tracks " + t + " clip_slots " + s + " clip");
  reply(id, { track: +t, slot: +s, name: g(c, "name"), length_beats: g(c, "length"), is_midi: g(c, "is_midi_clip") });
}
function doQuery(id, kind, a) {
  try {
    switch (String(kind)) {
      case "overview": qOverview(id); break;
      case "devices":  qDevices(id, a[0]); break;
      case "params":   qParams(id, a[0], a[1]); break;
      case "clip":     qClip(id, a[0], a[1]); break;
      default: reply(id, { error: "unknown query " + kind });
    }
  } catch (e) { reply(id, { error: String(e) }); }
}

// ───────────────────────── dispatch ─────────────────────────
function doAct(args) {
  var op = String(args[0]), a = args.slice(1);
  try {
    switch (op) {
      case "transport":    transport(a[0]); break;
      case "tempo":        setTempo(a[0]); break;
      case "metronome":    setMetro(a[0]); break;
      case "loop":         setLoop(a[0], a[1], a[2]); break;
      case "timesig":      setTimeSig(a[0], a[1]); break;
      case "capture_midi": captureMidi(); break;
      case "select_track": selectTrack(parseInt(a[0], 10)); break;
      case "create_track": createTrack(a[0], a[1]); break;
      case "delete_track": deleteTrack(a[0]); break;
      case "rename_track": renameTrack(a[0], a[1]); break;
      case "track_color":  trackColor(a[0], a[1]); break;
      case "volume":       setVolume(a[0], a[1]); break;
      case "pan":          setPan(a[0], a[1]); break;
      case "mute":         setMute(a[0], a[1]); break;
      case "solo":         setSolo(a[0], a[1]); break;
      case "arm":          setArm(a[0], a[1]); break;
      case "send":         setSend(a[0], a[1], a[2]); break;
      case "select_clip":  selectClip(a[0], a[1]); break;
      case "fire_clip":    fireClip(a[0], a[1]); break;
      case "stop_clip":    stopClip(a[0]); break;
      case "create_clip":  createClip(a[0], a[1], a[2]); break;
      case "delete_clip":  deleteClip(a[0], a[1]); break;
      case "clip_len":     clipLen(a[0], a[1], a[2]); break;
      case "clip_name":    clipName(a[0], a[1], a[2]); break;
      case "quantize":     quantizeClip(a[0], a[1], a[2]); break;
      case "add_notes":    addNotes(a[0], a[1], a.slice(2)); break;
      case "clear_notes":  clearNotes(a[0], a[1]); break;
      case "device_param": deviceParam(a[0], a[1], a[2], a[3]); break;
      case "device_on":    deviceOn(a[0], a[1], a[2]); break;
      case "select_scene": selectScene(a[0]); break;
      case "fire_scene":   fireScene(a[0]); break;
      case "create_scene": createScene(a[0]); break;
      case "delete_scene": deleteScene(a[0]); break;
      default: log("unknown op: " + op); return;
    }
    log(op + " " + a.join(" ") + " ✓");
  } catch (e) { log("err " + op + ": " + e); }
}

function anything() {
  var args = arrayfromargs(messagename, arguments);
  var head = args.shift();
  if (head === "act") {
    if (String(args[0]) === "query") doQuery(args[1], args[2], args.slice(3));
    else doAct(args);
  } else if (head === "cursor") {
    var k = args[0], op = k === "track" ? "select_track" : k === "clip" ? "select_clip" : k === "scene" ? "select_scene" : k;
    doAct([op, args[1], args[2]]);
  } else {
    doAct([head].concat(args)); // raw "op a b"
  }
}

post("skallywag_live.js loaded (full control)\n");

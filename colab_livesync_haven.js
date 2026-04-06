// coLaB LiveSync v7.0 — HAVEN VERSION
// Peers back to LOCAL machine (192.168.0.3)
// Everything else identical to colab_livesync.js

autowatch = 1;
inlets = 1;
outlets = 1;

var PEER = "192.168.0.3";
var UID = 'u' + Math.random().toString(36).substr(2, 4);
var ECHO_MS = 5000;
var ready = false;
var pollN = 0;

// =========================================================================
// HARDCODED TEMPLATE — from param-manifest.json
// =========================================================================

var TRACK_COUNT = 32;
var SCENE_COUNT = 8;

// Tracks with devices: [trackIdx, deviceIdx, paramCount]
var DEVICE_MAP = [
  [2, 0, 18],  // KICK — Instrument Rack
  [2, 1, 6],   // KICK — kHs Transient Shaper
  [2, 2, 5],   // KICK — GClip
  [8, 0, 84],  // MIDS — EQ Eight
  [8, 1, 19],  // MIDS — DONT YOU DARE (Saturator)
  [8, 2, 1],   // MIDS — ShaperBox 3
  [10, 0, 1],  // SYNTH 1 — Serum 2
  [11, 0, 1],  // SYNTH 2 — Serum 2
  [12, 0, 1],  // SYNTH 3 — Serum 2
  [16, 0, 1],  // SUB — ShaperBox 3
  [18, 0, 18], // SUB 1 — LYCAN HEAVIEST SUB V2
  [31, 0, 18]  // 32-MIDI — Instrument Rack
];

// Master devices: [deviceIdx, paramCount]
var MASTER_MAP = [
  [0, 12],  // Utility
  [1, 18],  // Audio Effect Rack
  [2, 52],  // soothe2
  [3, 5]    // GClip
];

// Group tracks (have fold_state)
var GROUP_TRACKS = [0, 1, 4, 8, 16, 19, 27];

// =========================================================================
// SNAPSHOTS
// =========================================================================

var mixSnap = [];
var devSnap = {};
var masterSnap = {};
var foldSnap = {};
var clipSnap = {};
var noteHash = {};
var tempoSnap = 0;
var echoLock = {};

// =========================================================================
// INIT
// =========================================================================

function init() {
  post("coLaB LiveSync v7.0 HAVEN init...\n");

  mixSnap = [];
  for (var i = 0; i < TRACK_COUNT; i++) {
    mixSnap.push(readMixer(i));
  }

  for (var d = 0; d < DEVICE_MAP.length; d++) {
    var dm = DEVICE_MAP[d];
    devSnap[dm[0] + ':' + dm[1]] = readDevParams(dm[0], dm[1], dm[2]);
  }

  for (var m = 0; m < MASTER_MAP.length; m++) {
    masterSnap[MASTER_MAP[m][0]] = readMasterParams(MASTER_MAP[m][0], MASTER_MAP[m][1]);
  }

  for (var g = 0; g < GROUP_TRACKS.length; g++) {
    try {
      foldSnap[GROUP_TRACKS[g]] = parseInt(new LiveAPI(null, "live_set tracks " + GROUP_TRACKS[g]).get("fold_state")) === 1;
    } catch(e) {}
  }

  tempoSnap = parseFloat(new LiveAPI(null, "live_set").get("tempo"));

  for (var t = 0; t < TRACK_COUNT; t++) {
    for (var c = 0; c < SCENE_COUNT; c++) {
      try {
        clipSnap[t + ':' + c] = parseInt(new LiveAPI(null, "live_set tracks " + t + " clip_slots " + c).get("has_clip")) === 1;
      } catch(e) { clipSnap[t + ':' + c] = false; }
    }
  }

  ready = true;
  outlet(0, "host", PEER);
  outlet(0, "port", 8001);
  post("LiveSync HAVEN ready. " + TRACK_COUNT + " tracks, peer=" + PEER + "\n");
}

function connect() {
  var a = arrayfromargs(arguments);
  if (a.length > 0) PEER = a[0].toString();
  outlet(0, "host", PEER);
  outlet(0, "port", 8001);
  post("Connected to " + PEER + "\n");
}

// =========================================================================
// READ HELPERS
// =========================================================================

function readMixer(idx) {
  try {
    var t = new LiveAPI(null, "live_set tracks " + idx);
    var v = new LiveAPI(null, "live_set tracks " + idx + " mixer_device volume");
    var p = new LiveAPI(null, "live_set tracks " + idx + " mixer_device panning");
    var s = { vol: parseFloat(v.get("value")), pan: parseFloat(p.get("value")),
              mute: parseInt(t.get("mute")), solo: parseInt(t.get("solo")),
              arm: 0, color: parseInt(t.get("color_index")), name: t.get("name").toString() };
    try { s.arm = parseInt(t.get("arm")); } catch(e) {}
    return s;
  } catch(e) { return {vol:0.85,pan:0,mute:0,solo:0,arm:0,color:0,name:''}; }
}

function readDevParams(trackIdx, devIdx, count) {
  var vals = [];
  for (var p = 0; p < count; p++) {
    try {
      vals.push(parseFloat(new LiveAPI(null, "live_set tracks " + trackIdx + " devices " + devIdx + " parameters " + p).get("value")));
    } catch(e) { vals.push(0); }
  }
  return vals;
}

function readMasterParams(devIdx, count) {
  var vals = [];
  for (var p = 0; p < count; p++) {
    try {
      vals.push(parseFloat(new LiveAPI(null, "live_set master_track devices " + devIdx + " parameters " + p).get("value")));
    } catch(e) { vals.push(0); }
  }
  return vals;
}

function readClipNotes(trackIdx, clipIdx) {
  try {
    var clip = new LiveAPI(null, "live_set tracks " + trackIdx + " clip_slots " + clipIdx + " clip");
    var isMidi = parseInt(clip.get("is_midi_clip"));
    if (!isMidi) return null;
    var len = parseFloat(clip.get("length"));
    var notes = clip.call("get_notes", 0, 0, Math.ceil(len) + 1, 128);
    var result = [];
    if (notes && notes.length) {
      for (var i = 0; i < notes.length; i += 5) {
        result.push({p: notes[i], t: notes[i+1], d: notes[i+2], v: notes[i+3], m: notes[i+4]});
      }
    }
    return result;
  } catch(e) { return null; }
}

function hashNotes(notes) {
  if (!notes || notes.length === 0) return '';
  var parts = [];
  for (var i = 0; i < notes.length; i++) {
    parts.push(notes[i].p + ':' + notes[i].t + ':' + notes[i].d);
  }
  parts.sort();
  return parts.join('|');
}

// =========================================================================
// POLL — called by [metro 100] (10Hz)
// =========================================================================

function poll() {
  if (!ready) return;
  pollN++;

  var base = (pollN * 4) % TRACK_COUNT;
  for (var i = 0; i < 4; i++) {
    pollMixerTrack((base + i) % TRACK_COUNT);
  }

  if (pollN % 5 === 0) {
    var di = Math.floor(pollN / 5) % DEVICE_MAP.length;
    pollDevice(DEVICE_MAP[di]);
  }

  if (pollN % 10 === 0) {
    var mi = Math.floor(pollN / 10) % MASTER_MAP.length;
    pollMasterDevice(MASTER_MAP[mi]);
  }

  if (pollN % 5 === 0) pollTempo();
  if (pollN % 10 === 1) pollFold();

  if (pollN % 3 === 0) {
    var ct = Math.floor(pollN / 3) % TRACK_COUNT;
    pollClips(ct);
  }

  if (pollN % 10 === 2) pollNotes();
}

// =========================================================================
// POLL FUNCTIONS
// =========================================================================

function pollMixerTrack(idx) {
  if (locked('m:' + idx)) return;
  var cur = readMixer(idx);
  var old = mixSnap[idx];
  if (!old) return;

  if (Math.abs(cur.vol - old.vol) > 0.001) { old.vol = cur.vol; send({t:'mx',i:idx,p:'vol',v:cur.vol}); }
  if (Math.abs(cur.pan - old.pan) > 0.001) { old.pan = cur.pan; send({t:'mx',i:idx,p:'pan',v:cur.pan}); }
  if (cur.mute !== old.mute) { old.mute = cur.mute; send({t:'mx',i:idx,p:'mute',v:cur.mute}); }
  if (cur.solo !== old.solo) { old.solo = cur.solo; send({t:'mx',i:idx,p:'solo',v:cur.solo}); }
  if (cur.arm !== old.arm) { old.arm = cur.arm; send({t:'mx',i:idx,p:'arm',v:cur.arm}); }
  if (cur.color !== old.color) { old.color = cur.color; send({t:'mx',i:idx,p:'color',v:cur.color}); }
  if (cur.name !== old.name) { old.name = cur.name; send({t:'mx',i:idx,p:'name',v:cur.name}); }
}

function pollDevice(dm) {
  var key = dm[0] + ':' + dm[1];
  if (locked('d:' + key)) return;
  var cur = readDevParams(dm[0], dm[1], dm[2]);
  var old = devSnap[key];
  if (!old) { devSnap[key] = cur; return; }

  for (var p = 0; p < cur.length; p++) {
    if (Math.abs(cur[p] - old[p]) > 0.0001) {
      old[p] = cur[p];
      send({t:'dp',ti:dm[0],di:dm[1],pi:p,v:cur[p]});
    }
  }
}

function pollMasterDevice(mm) {
  if (locked('md:' + mm[0])) return;
  var cur = readMasterParams(mm[0], mm[1]);
  var old = masterSnap[mm[0]];
  if (!old) { masterSnap[mm[0]] = cur; return; }

  for (var p = 0; p < cur.length; p++) {
    if (Math.abs(cur[p] - old[p]) > 0.0001) {
      old[p] = cur[p];
      send({t:'mp',di:mm[0],pi:p,v:cur[p]});
    }
  }
}

function pollTempo() {
  if (locked('tempo')) return;
  try {
    var t = parseFloat(new LiveAPI(null, "live_set").get("tempo"));
    if (Math.abs(t - tempoSnap) > 0.01) { tempoSnap = t; send({t:'tp',v:t}); }
  } catch(e) {}
}

function pollFold() {
  for (var g = 0; g < GROUP_TRACKS.length; g++) {
    var gi = GROUP_TRACKS[g];
    if (locked('f:' + gi)) continue;
    try {
      var f = parseInt(new LiveAPI(null, "live_set tracks " + gi).get("fold_state")) === 1;
      if (foldSnap[gi] !== undefined && foldSnap[gi] !== f) {
        foldSnap[gi] = f;
        send({t:'fd',i:gi,v:f?1:0});
      }
      if (foldSnap[gi] === undefined) foldSnap[gi] = f;
    } catch(e) {}
  }
}

function pollClips(trackIdx) {
  for (var c = 0; c < SCENE_COUNT; c++) {
    var key = trackIdx + ':' + c;
    if (locked('c:' + key)) continue;
    try {
      var has = parseInt(new LiveAPI(null, "live_set tracks " + trackIdx + " clip_slots " + c).get("has_clip")) === 1;
      var old = clipSnap[key];
      if (old !== undefined && has && !old) {
        clipSnap[key] = true;
        var clip = new LiveAPI(null, "live_set tracks " + trackIdx + " clip_slots " + c + " clip");
        var name = clip.get("name").toString();
        var len = parseFloat(clip.get("length"));
        var notes = readClipNotes(trackIdx, c);
        send({t:'cc',ti:trackIdx,ci:c,name:name,len:len,notes:notes||[]});
        if (notes) noteHash[key] = hashNotes(notes);
        post("CLIP CREATE: T" + trackIdx + ":C" + c + " notes=" + (notes ? notes.length : 0) + "\n");
      }
      if (old !== undefined && !has && old) {
        clipSnap[key] = false;
        send({t:'cd',ti:trackIdx,ci:c});
      }
      if (old === undefined) clipSnap[key] = has;
    } catch(e) {}
  }
}

function pollNotes() {
  if (!this._noteIdx) this._noteIdx = 0;
  for (var n = 0; n < TRACK_COUNT; n++) {
    var ti = (this._noteIdx + n) % TRACK_COUNT;
    for (var c = 0; c < SCENE_COUNT; c++) {
      var key = ti + ':' + c;
      if (!clipSnap[key] || locked('c:' + key)) continue;
      var notes = readClipNotes(ti, c);
      if (notes) {
        var h = hashNotes(notes);
        if (noteHash[key] && noteHash[key] !== h) {
          noteHash[key] = h;
          send({t:'cn',ti:ti,ci:c,notes:notes});
          post("NOTES CHANGED: T" + ti + ":C" + c + " (" + notes.length + ")\n");
        }
        if (!noteHash[key]) noteHash[key] = h;
      }
      this._noteIdx = (ti + 1) % TRACK_COUNT;
      return;
    }
  }
  this._noteIdx = (this._noteIdx + 1) % TRACK_COUNT;
}

// =========================================================================
// SEND
// =========================================================================

function send(data) {
  data.u = UID;
  outlet(0, JSON.stringify(data));
}

// =========================================================================
// RECEIVE + APPLY
// =========================================================================

function anything() {
  var addr = messagename;
  var args = arrayfromargs(arguments);

  if (addr === "incoming" || addr === "/incoming") {
    var raw = args.join(" ");
    if (raw.indexOf("{") >= 0) applyDelta(raw);
    else if (raw === "init") init();
    else if (raw === "poll") poll();
    else if (raw.indexOf("connect ") === 0) connect(raw.substring(8));
    return;
  }

  if (addr.charAt(0) === "/") {
    if (addr === "/msg") post("[MSG] " + args.join(" ") + "\n");
    else if (addr === "/eval") { try { post("[EVAL] " + eval(args.join(" ")) + "\n"); } catch(e) { post("[ERR] " + e + "\n"); } }
    return;
  }

  if (addr === "text") {
    var msg = args.join(" ");
    var f = new File("C:/Users/4382/colab/claude-inbox.txt", "write");
    if (f.isopen) { f.writeline(Date.now() + "|" + msg); f.close(); }
    return;
  }

  var raw2 = addr + " " + args.join(" ");
  if (raw2.indexOf("{") >= 0) applyDelta(raw2.substring(raw2.indexOf("{")));
}

function applyDelta(raw) {
  try {
    var d = JSON.parse(raw);
    if (d.u === UID) return;

    switch(d.t) {
      case 'mx': applyMixer(d); break;
      case 'dp': applyDevParam(d); break;
      case 'mp': applyMasterParam(d); break;
      case 'tp': applyTempo(d); break;
      case 'fd': applyFold(d); break;
      case 'cc': applyClipCreate(d); break;
      case 'cd': applyClipDelete(d); break;
      case 'cn': applyClipNotes(d); break;
    }
  } catch(e) { post("APPLY ERR: " + e + "\n"); }
}

function applyMixer(d) {
  lock('m:' + d.i);
  try {
    if (d.p === 'vol') new LiveAPI(null, "live_set tracks " + d.i + " mixer_device volume").set("value", d.v);
    else if (d.p === 'pan') new LiveAPI(null, "live_set tracks " + d.i + " mixer_device panning").set("value", d.v);
    else {
      var t = new LiveAPI(null, "live_set tracks " + d.i);
      if (d.p === 'mute') t.set("mute", d.v);
      else if (d.p === 'solo') t.set("solo", d.v);
      else if (d.p === 'arm') t.set("arm", d.v);
      else if (d.p === 'color') t.set("color_index", d.v);
      else if (d.p === 'name') t.set("name", d.v);
    }
    if (mixSnap[d.i]) {
      if (d.p === 'vol') mixSnap[d.i].vol = d.v;
      else if (d.p === 'pan') mixSnap[d.i].pan = d.v;
      else if (d.p === 'mute') mixSnap[d.i].mute = d.v;
      else if (d.p === 'solo') mixSnap[d.i].solo = d.v;
      else if (d.p === 'arm') mixSnap[d.i].arm = d.v;
      else if (d.p === 'color') mixSnap[d.i].color = d.v;
      else if (d.p === 'name') mixSnap[d.i].name = d.v;
    }
  } catch(e) {}
}

function applyDevParam(d) {
  lock('d:' + d.ti + ':' + d.di);
  try {
    new LiveAPI(null, "live_set tracks " + d.ti + " devices " + d.di + " parameters " + d.pi).set("value", d.v);
    var key = d.ti + ':' + d.di;
    if (devSnap[key]) devSnap[key][d.pi] = d.v;
  } catch(e) {}
}

function applyMasterParam(d) {
  lock('md:' + d.di);
  try {
    new LiveAPI(null, "live_set master_track devices " + d.di + " parameters " + d.pi).set("value", d.v);
    if (masterSnap[d.di]) masterSnap[d.di][d.pi] = d.v;
  } catch(e) {}
}

function applyTempo(d) {
  lock('tempo');
  try { new LiveAPI(null, "live_set").set("tempo", d.v); tempoSnap = d.v; } catch(e) {}
}

function applyFold(d) {
  lock('f:' + d.i);
  try { new LiveAPI(null, "live_set tracks " + d.i).set("fold_state", d.v); foldSnap[d.i] = d.v === 1; } catch(e) {}
}

function applyClipCreate(d) {
  lock('c:' + d.ti + ':' + d.ci);
  try {
    var slot = new LiveAPI(null, "live_set tracks " + d.ti + " clip_slots " + d.ci);
    if (parseInt(slot.get("has_clip")) === 0) {
      slot.call("create_clip", d.len || 4);
    }
    if (d.name) {
      new LiveAPI(null, "live_set tracks " + d.ti + " clip_slots " + d.ci + " clip").set("name", d.name);
    }
    if (d.notes && d.notes.length > 0) {
      var clip = new LiveAPI(null, "live_set tracks " + d.ti + " clip_slots " + d.ci + " clip");
      clip.call("set_notes");
      clip.call("notes", d.notes.length);
      for (var n = 0; n < d.notes.length; n++) {
        clip.call("note", d.notes[n].p||60, d.notes[n].t||0, d.notes[n].d||0.25, d.notes[n].v||100, d.notes[n].m||0);
      }
      clip.call("done");
    }
    clipSnap[d.ti + ':' + d.ci] = true;
    if (d.notes) noteHash[d.ti + ':' + d.ci] = hashNotes(d.notes);
    post("APPLIED clip T" + d.ti + ":C" + d.ci + " notes=" + (d.notes ? d.notes.length : 0) + "\n");
  } catch(e) { post("CLIP CREATE ERR: " + e + "\n"); }
}

function applyClipDelete(d) {
  lock('c:' + d.ti + ':' + d.ci);
  try {
    var slot = new LiveAPI(null, "live_set tracks " + d.ti + " clip_slots " + d.ci);
    if (parseInt(slot.get("has_clip")) === 1) slot.call("delete_clip");
    clipSnap[d.ti + ':' + d.ci] = false;
    delete noteHash[d.ti + ':' + d.ci];
  } catch(e) {}
}

function applyClipNotes(d) {
  lock('c:' + d.ti + ':' + d.ci);
  try {
    var clip = new LiveAPI(null, "live_set tracks " + d.ti + " clip_slots " + d.ci + " clip");
    clip.call("remove_notes", 0, 0, 99999, 128);
    if (d.notes && d.notes.length > 0) {
      clip.call("set_notes");
      clip.call("notes", d.notes.length);
      for (var n = 0; n < d.notes.length; n++) {
        clip.call("note", d.notes[n].p||60, d.notes[n].t||0, d.notes[n].d||0.25, d.notes[n].v||100, d.notes[n].m||0);
      }
      clip.call("done");
    }
    noteHash[d.ti + ':' + d.ci] = hashNotes(d.notes);
  } catch(e) { post("NOTES ERR: " + e + "\n"); }
}

// =========================================================================
// ECHO GUARD
// =========================================================================

function lock(key) { echoLock[key] = Date.now() + ECHO_MS; }
function locked(key) {
  var u = echoLock[key];
  if (!u) return false;
  if (Date.now() >= u) { delete echoLock[key]; return false; }
  return true;
}

// =========================================================================
// UTILITY
// =========================================================================

function refresh() { ready = false; pollN = 0; init(); }

function dbg() {
  post("=== LiveSync v7 HAVEN ===\n");
  post("tracks:" + TRACK_COUNT + " devices:" + DEVICE_MAP.length + " master:" + MASTER_MAP.length + "\n");
  post("polls:" + pollN + " locks:" + Object.keys(echoLock).length + " peer:" + PEER + "\n");
  post("=========================\n");
}

function notifydeleted() { ready = false; }
function save() { ready = false; }

post("coLaB LiveSync v7.0 HAVEN loaded. Send init to start.\n");

'use strict';
/**
 * server.js - I/O shell around jam-core.js.
 *   UDP 9450 in  (wire 1, from rawmouse.exe)       UDP 9451 out (wire 2, JAM/PING)
 *   HTTP + WS 9460 (wire 3, panel)
 *   Ableton: AbletonOSC (UDP 11000 out / 11001 in) is the primary transport; AbletonBridge TCP 9877 is the
 *   fallback when OSC is unavailable (11001 owned by someone else, or Live does not answer).
 *
 * Flags:
 *   --dry-run       read-only queries and listeners go to Ableton for real; modifying commands are logged, NOT sent
 *   --no-ableton    do not touch Ableton at all; a fake session is simulated (commands mutate the fake)
 *   --no-osc        never use AbletonOSC (bridge only)
 *   --port N        HTTP/WS port (default 9460)
 *   --udp-in N      wire-1 port (default 9450)       --udp-out N   wire-2 port (default 9451)
 *   --osc-host H --osc-out N --osc-in N   AbletonOSC endpoint (defaults 127.0.0.1, 11000, 11001)
 *   --sens F        pixels per raw mouse count (default 1.0)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const dgram = require('dgram');

const ROOT = path.join(__dirname, '..', '..'); // colab repo root
const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
const AbletonClient = require(path.join(ROOT, 'js', 'hub', 'ableton-client.js'));
const core = require('./jam-core');
const { actionToOsc } = require('./osc-codec');
const { OscLink } = require('./osc-link');
const { MouseMuxInput } = require('./mousemux-input');

// ------------------------------------------------------------------ args
function parseArgs(argv) {
  const a = { dryRun: false, noAbleton: false, noOsc: false, port: 9460, udpIn: 9450, udpOut: 9451, sens: 1.0, oscHost: '127.0.0.1', oscOut: 11000, oscIn: 11001 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i];
    const num = () => {
      const v = Number(val());
      if (!Number.isFinite(v)) { console.error('bad value for ' + k); process.exit(2); }
      return v;
    };
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--no-ableton') a.noAbleton = true;
    else if (k === '--no-osc') a.noOsc = true;
    else if (k === '--port') a.port = num();
    else if (k === '--udp-in') a.udpIn = num();
    else if (k === '--udp-out') a.udpOut = num();
    else if (k === '--sens') a.sens = num();
    else if (k === '--mousemux') a.mousemux = true;
    else if (k === '--mousemux-url') a.mousemuxUrl = val();
    else if (k === '--mousemux-rect') {
      const values = String(val()).split(',').map(Number);
      if (values.length !== 4 || !values.every(Number.isSafeInteger) || values[2] <= 1 || values[3] <= 1) {
        console.error('--mousemux-rect needs physical screen pixels: x,y,width,height (size > 1)'); process.exit(2);
      }
      a.mousemuxRect = { x: values[0], y: values[1], w: values[2], h: values[3] };
    }
    else if (k === '--osc-host') a.oscHost = val();
    else if (k === '--osc-out') a.oscOut = num();
    else if (k === '--osc-in') a.oscIn = num();
    else { console.error('unknown flag ' + k + '\nflags: --dry-run --no-ableton --no-osc --port N --udp-in N --udp-out N --osc-host H --osc-out N --osc-in N --sens F'); process.exit(2); }
  }
  if (a.mousemux && !a.mousemuxRect) {
    console.error('--mousemux requires --mousemux-rect x,y,width,height for the panel canvas'); process.exit(2);
  }
  if (!a.mousemux && (a.mousemuxRect || a.mousemuxUrl)) {
    console.error('--mousemux-rect and --mousemux-url require --mousemux'); process.exit(2);
  }
  return a;
}
const ARGS = parseArgs(process.argv.slice(2));
const MODE = ARGS.noAbleton ? 'offline-fake' : ARGS.dryRun ? 'dry-run' : 'live';
const log = (...m) => console.log(new Date().toISOString().slice(11, 23), ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();

// ------------------------------------------------------------------ state
const jam = core.createJam({ sensitivity: ARGS.sens, viewport: { w: 1280, h: 720 } });
const S = core.emptySession(); // server-held session; pushed into the jam via jam.setSession
const cmdLog = []; // every Ableton action produced (sent / dry / dropped)
const LOG_CAP = 5000;
let clientBridge = null;
let lastError = '';
let transport = 'none'; // 'osc' | 'bridge' | 'none'
let oscNote = '';
let osc = null;
let coldFillMs = null;
let shuttingDown = false;

const pushSession = (patch) => {
  jam.setSession(patch || { tracks: S.tracks, slots: S.slots, scenes: S.scenes, trackCount: S.trackCount, sceneCount: S.sceneCount, ready: S.ready });
  if (coldFillMs === null && S.ready && S.trackCount && jam.visibleTracks().every((t) => S.slots[t])) {
    coldFillMs = Date.now() - T0;
    log('cold fill of visible tracks done in ' + coldFillMs + ' ms via ' + transport);
  }
};

// ------------------------------------------------------------------ AbletonOSC engine
const O = { playIdx: [], firedIdx: [], listenN: 0, last: { session: 0, tracks: 0, vol: 0 }, slotAt: new Map(), inflight: new Set(), failStreak: 0 };

function rebuildPlaying() {
  const map = {};
  for (let t = 0; t < O.listenN; t++) {
    const p = O.playIdx[t], f = O.firedIdx[t];
    if (p >= 0) map[t + ':' + p] = 'playing';
    if (f >= 0 && f !== p) map[t + ':' + f] = 'triggered';
  }
  S.playing = map;
  jam.setPlaying(map);
}

function onOscMessage(address, args) {
  if (address === '/live/track/get/playing_slot_index') { O.playIdx[args[0]] = args[1]; rebuildPlaying(); }
  else if (address === '/live/track/get/fired_slot_index') { O.firedIdx[args[0]] = args[1]; rebuildPlaying(); }
}

function ensureListeners(n) {
  if (n > O.listenN) {
    for (let t = O.listenN; t < n; t++) {
      osc.send('/live/track/start_listen/playing_slot_index', [t]);
      osc.send('/live/track/start_listen/fired_slot_index', [t]);
    }
  } else if (n < O.listenN) {
    for (let t = n; t < O.listenN; t++) {
      osc.send('/live/track/stop_listen/playing_slot_index', [t]);
      osc.send('/live/track/stop_listen/fired_slot_index', [t]);
    }
  }
  O.listenN = n;
}

function stopAllListeners() {
  if (!osc) return;
  for (let t = 0; t < O.listenN; t++) {
    osc.send('/live/track/stop_listen/playing_slot_index', [t]);
    osc.send('/live/track/stop_listen/fired_slot_index', [t]);
  }
  O.listenN = 0;
}

const q = (address, args, prefix, ms) => osc.query(address, args, prefix, ms);

/** Run `fn` unless a job with the same key is already in flight. */
function job(key, fn) {
  if (O.inflight.has(key)) return;
  O.inflight.add(key);
  fn().then(() => { O.failStreak = 0; }, (e) => { lastError = String(e && e.message || e); if (++O.failStreak >= 6 && transport === 'osc') { transport = 'bridge'; oscNote = 'AbletonOSC stopped answering, using bridge'; log(oscNote); } })
    .finally(() => O.inflight.delete(key));
}

function oscTick() {
  if (transport !== 'osc' || shuttingDown) return;
  const now = Date.now();
  if (!S.trackCount || now - O.last.session > 8000) {
    O.last.session = now;
    job('session', async () => {
      const [nt] = await q('/live/song/get/num_tracks', [], [], 2000);
      const [ns] = await q('/live/song/get/num_scenes', [], [], 2000);
      const names = ns > 0 ? await q('/live/song/get/scenes/name', [], [], 2000) : [];
      S.trackCount = nt; S.sceneCount = ns; S.scenes = names.map((n) => ({ name: n || '' }));
      ensureListeners(nt);
      pushSession();
    });
  }
  if (S.trackCount && now - O.last.tracks > 3000) {
    O.last.tracks = now;
    job('tracks', async () => {
      const r = await q('/live/song/get/track_data', [0, -1, 'track.name', 'track.color_index', 'track.mute', 'track.is_foldable'], [], 2500);
      for (let t = 0; t < S.trackCount; t++) {
        const o = t * 4, prev = S.tracks[t] || {};
        S.tracks[t] = { name: r[o], color: r[o + 1], mute: !!r[o + 2], group: !!r[o + 3], volume: prev.volume };
      }
      S.ready = true;
      pushSession();
    });
  }
  if (S.ready && now - O.last.vol > 1000) {
    O.last.vol = now;
    for (const t of jam.visibleTracks()) {
      job('vol' + t, async () => {
        const r = await q('/live/track/get/volume', [t], [t], 1500);
        if (S.tracks[t]) { S.tracks[t].volume = r[1]; pushSession(); }
      });
    }
  }
  for (const t of S.ready ? jam.visibleTracks() : []) {
    if (now - (O.slotAt.get(t) || 0) > 2500) {
      O.slotAt.set(t, now);
      job('slots' + t, async () => {
        const r = await q('/live/track/get/clips/name', [t], [t], 2000);
        S.slots[t] = r.slice(1).map((n) => ({ has: n !== null, name: n || '' }));
        pushSession();
      });
    }
  }
}

async function startOsc() {
  if (ARGS.noOsc) { oscNote = 'AbletonOSC disabled (--no-osc)'; return; }
  osc = new OscLink({ host: ARGS.oscHost, outPort: ARGS.oscOut, inPort: ARGS.oscIn });
  try {
    await osc.bind();
  } catch (e) {
    oscNote = `OSC reply port ${ARGS.oscIn} unavailable (${e.code || e.message}), using bridge polling`;
    osc.close(); osc = null;
    log(oscNote);
    return;
  }
  osc.onMessage(onOscMessage);
  const probe = async () => {
    if (transport === 'osc' || shuttingDown) return;
    try {
      await q('/live/song/get/num_tracks', [], [], 2000);
      transport = 'osc'; oscNote = '';
      log('AbletonOSC answering on ' + ARGS.oscHost + ':' + ARGS.oscOut + ' (replies on ' + ARGS.oscIn + ')');
    } catch (e) {
      oscNote = 'no reply from AbletonOSC, using bridge polling';
    }
  };
  await probe();
  setInterval(probe, 5000).unref();
  setInterval(oscTick, 100).unref();
}

// ------------------------------------------------------------------ AbletonBridge (fallback transport)
const POLL = { playingMs: 600, tracksMs: 3000, sessionMs: 8000, slotMs: 2500 };
const last = { playing: 0, tracks: 0, session: 0 };
const slotFetchedAt = new Map();
const dirtyTracks = new Set();
let forcePlaying = false;
let polling = false;

const send = (type, params) => clientBridge.send(type, params || {});

async function pollOnce() {
  const now = Date.now();
  if (!S.trackCount || now - last.session > POLL.sessionMs) {
    const info = await send('get_session_info');
    const sc = await send('get_scenes');
    S.trackCount = info.track_count | 0;
    S.sceneCount = sc.count != null ? sc.count : (sc.scenes || []).length;
    S.scenes = (sc.scenes || []).map((s) => ({ name: s.name || '' }));
    last.session = Date.now();
    pushSession();
    return true;
  }
  if (forcePlaying || now - last.playing > POLL.playingMs) {
    forcePlaying = false;
    const r = await send('get_playing_clips');
    const map = {};
    for (const c of r.playing_clips || []) map[c.track_index + ':' + c.clip_index] = c.status;
    last.playing = Date.now();
    jam.setPlaying(map);
    S.playing = map;
    return true;
  }
  if (dirtyTracks.size) {
    const t = dirtyTracks.values().next().value;
    dirtyTracks.delete(t);
    await fetchTrack(t);
    return true;
  }
  if (now - last.tracks > POLL.tracksMs) {
    const r = await send('get_all_tracks_info');
    const tracks = [];
    for (const t of r.tracks || []) tracks[t.index] = { name: t.name, volume: t.volume, color: t.color_index, mute: !!t.mute, group: !!t.is_group_track };
    S.tracks = tracks;
    S.ready = true;
    last.tracks = Date.now();
    pushSession();
    return true;
  }
  let pick = -1;
  let oldest = Infinity;
  for (const t of jam.visibleTracks()) {
    const at = slotFetchedAt.get(t) || 0;
    if (now - at > POLL.slotMs && at < oldest) { oldest = at; pick = t; }
  }
  if (pick >= 0) { await fetchTrack(pick); return true; }
  return false;
}

async function fetchTrack(t) {
  slotFetchedAt.set(t, Date.now());
  const r = await send('get_track_info', { track_index: t });
  S.slots[t] = (r.clip_slots || []).map((cs) => ({ has: !!cs.has_clip, name: cs.clip ? cs.clip.name || '' : '' }));
  pushSession();
}

async function pollLoop() {
  polling = true;
  while (polling) {
    try {
      if (transport === 'osc' || !clientBridge.isConnected()) { await sleep(400); continue; }
      const did = await pollOnce();
      if (!did) await sleep(40);
    } catch (e) {
      lastError = String(e && e.message || e);
      await sleep(700);
    }
  }
}

async function connectLoop() {
  clientBridge = new AbletonClient();
  clientBridge.on('error', (e) => { lastError = String(e && e.message || e); });
  for (;;) {
    try { await clientBridge.connect(); return; } catch (e) { lastError = String(e.message || e); await sleep(3000); }
  }
}

// ------------------------------------------------------------------ fake session (--no-ableton)
function buildFake() {
  const names = ['KICK', 'SNARE', 'HATS', 'PERC', 'BASS', 'SUB', 'LEAD', 'PAD', 'ARP', 'KEYS', 'FX 1', 'FX 2', 'VOX', 'CHOP', 'RISE', 'DOWN', 'TEXTURE', 'DRONE', 'STAB', 'PLUCK', 'BELL', 'NOISE', 'REF', 'MASTER BUS'];
  S.trackCount = names.length;
  S.sceneCount = 12;
  S.scenes = Array.from({ length: 12 }, (_, i) => ({ name: ['INTRO', 'BUILD', 'DROP A', 'BREAK', 'DROP B', 'OUTRO'][i] || '' }));
  S.tracks = names.map((n, i) => ({ name: n, volume: 0.85 - (i % 5) * 0.08, color: [14, 1, 3, 5, 8, 9, 11, 12][i % 8] + (i >= 16 ? 14 : 0), mute: false, group: false }));
  S.slots = names.map((n, t) => Array.from({ length: 12 }, (_, s) => {
    const has = (t * 7 + s * 3) % 5 < 2;
    return { has, name: has ? n.toLowerCase() + ' ' + (s + 1) : '' };
  }));
  S.playing = { '0:0': 'playing', '4:2': 'playing', '6:1': 'triggered' };
  S.ready = true;
  jam.setPlaying(S.playing);
  pushSession();
}

function applyFake(a) {
  const p = a.params;
  const slot = (t, s) => (S.slots[t] || [])[s];
  switch (a.cmd) {
    case 'fire_clip': {
      for (const k of Object.keys(S.playing)) if (k.startsWith(p.track_index + ':')) delete S.playing[k];
      S.playing[p.track_index + ':' + p.clip_index] = 'playing';
      break;
    }
    case 'stop_clip':
    case 'stop_track_clips':
      for (const k of Object.keys(S.playing)) if (k.startsWith(p.track_index + ':') && (p.clip_index == null || k === p.track_index + ':' + p.clip_index)) delete S.playing[k];
      break;
    case 'fire_scene':
      for (let t = 0; t < S.trackCount; t++) {
        for (const k of Object.keys(S.playing)) if (k.startsWith(t + ':')) delete S.playing[k];
        const sl = slot(t, p.scene_index);
        if (sl && sl.has) S.playing[t + ':' + p.scene_index] = 'playing';
      }
      break;
    case 'delete_clip': { const sl = slot(p.track_index, p.clip_index); if (sl) { sl.has = false; sl.name = ''; } break; }
    case 'duplicate_clip': { const src = slot(p.track_index, p.clip_index); const dst = slot(p.track_index, p.target_clip_index); if (src && dst) { dst.has = true; dst.name = src.name; } break; }
    case 'set_track_volume': if (S.tracks[p.track_index]) S.tracks[p.track_index].volume = p.volume; break;
    default: break;
  }
  jam.setPlaying(S.playing);
  pushSession();
}

// ------------------------------------------------------------------ action dispatch
function dispatch(a, rxAt) {
  const rec = { ts: Date.now(), player: a.player, cmd: a.cmd, params: a.params, udp: !!a.udp, final: !!a.final, via: '', outcome: '', procUs: null };
  const om = transport === 'osc' ? actionToOsc(a) : null;
  rec.via = ARGS.noAbleton ? 'fake' : om ? 'osc' : 'bridge';
  if (ARGS.noAbleton) {
    applyFake(a);
    rec.outcome = 'fake';
  } else if (ARGS.dryRun) {
    rec.outcome = 'dry-run';
  } else if (om) {
    osc.send(om.address, om.args);
    rec.outcome = 'sent-osc';
    const t = a.params.track_index;
    if (t != null && (a.cmd === 'duplicate_clip' || a.cmd === 'delete_clip' || a.cmd === 'set_clip_color')) setTimeout(() => O.slotAt.delete(t), 250).unref();
  } else if (!clientBridge || !clientBridge.isConnected()) {
    rec.outcome = 'dropped-not-connected';
  } else if (a.udp) {
    clientBridge.sendUDP(a.cmd, a.params);
    rec.outcome = 'sent-udp';
  } else {
    rec.outcome = 'sent-tcp';
    clientBridge.send(a.cmd, a.params).then(() => {
      if (a.cmd === 'fire_clip' || a.cmd === 'stop_clip' || a.cmd === 'stop_track_clips' || a.cmd === 'fire_scene') forcePlaying = true;
      if (a.params.track_index != null && a.cmd !== 'set_track_volume' && a.cmd !== 'select_track') dirtyTracks.add(a.params.track_index);
    }).catch((e) => { rec.outcome = 'error: ' + e.message; lastError = e.message; });
  }
  if (rxAt) rec.procUs = Math.round(Number(process.hrtime.bigint() - rxAt) / 1000);
  cmdLog.push(rec);
  if (cmdLog.length > LOG_CAP) cmdLog.splice(0, cmdLog.length - LOG_CAP);
  if (!(a.udp && !a.final)) log('CMD', JSON.stringify({ player: a.player, cmd: a.cmd, params: a.params, via: rec.via, outcome: rec.outcome, procUs: rec.procUs }));
}
const dispatchAll = (acts, rxAt) => { for (const a of acts) dispatch(a, rxAt); };

const mousemux = ARGS.mousemux ? new MouseMuxInput({
  url: ARGS.mousemuxUrl,
  rect: ARGS.mousemuxRect,
  onDatagram: (text) => dispatchAll(jam.handleDatagram(text, Date.now()), process.hrtime.bigint()),
}) : null;

// ------------------------------------------------------------------ wire 2 (to rawmouse)
const out = dgram.createSocket('udp4');
out.on('error', (e) => log('udp-out error', e.message));
const toRawmouse = (text) => { const b = Buffer.from(text + '\n'); out.send(b, 0, b.length, ARGS.udpOut, '127.0.0.1'); };

// ------------------------------------------------------------------ wire 1 (from rawmouse)
const inSock = dgram.createSocket('udp4');
inSock.on('error', (e) => { console.error('udp-in error: ' + e.message); process.exit(1); });
inSock.on('message', (buf) => {
  if (mousemux) return;
  const rxAt = process.hrtime.bigint();
  dispatchAll(jam.handleDatagram(buf.toString('utf8'), Date.now()), rxAt);
});

// ------------------------------------------------------------------ HTTP + WS (wire 3)
const PANEL = path.join(__dirname, 'panel.html');
const ownOrigin = (o) => !o || o === 'http://127.0.0.1:' + ARGS.port || o === 'http://localhost:' + ARGS.port;
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(PANEL, (err, data) => {
      if (err) { res.writeHead(500); res.end('panel.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } else if (url === '/api/log') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ mode: MODE, dryRun: ARGS.dryRun, transport, coldFillMs, commands: cmdLog }));
  } else if (url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(buildState()));
  } else if (url === '/api/shutdown' && req.method === 'POST' && !req.headers.origin) {
    res.writeHead(200); res.end('bye');
    shutdown();
  } else {
    res.writeHead(404); res.end('not found');
  }
});

const wss = new WebSocket.Server({ server, path: '/ws', verifyClient: ({ origin }) => ownOrigin(origin) });

function buildState() {
  const st = jam.render(Date.now());
  delete st.now;
  st.status.ableton = {
    mode: MODE,
    transport,
    connected: ARGS.noAbleton ? false : transport === 'osc' ? true : !!(clientBridge && clientBridge.isConnected()),
    bridgeConnected: !!(clientBridge && clientBridge.isConnected()),
    fake: ARGS.noAbleton,
    note: oscNote,
    coldFillMs,
    error: lastError,
  };
  st.status.udpIn = ARGS.udpIn;
  st.status.sens = ARGS.sens;
  st.status.mousemux = mousemux ? { ...mousemux.getStatus(), rect: ARGS.mousemuxRect } : null;
  if (mousemux) st.status.jam = st.status.mousemux.enabled && st.status.mousemux.connected;
  st.log = cmdLog.slice(-6).map((c) => ({ player: c.player, cmd: c.cmd, params: c.params, outcome: c.outcome, via: c.via, udp: c.udp, final: c.final }));
  return st;
}

let lastBody = '';
let lastSentAt = 0;
function broadcast(force) {
  const body = JSON.stringify(buildState());
  const t = Date.now();
  if (!force && body === lastBody && t - lastSentAt < 1000) return;
  lastBody = body; lastSentAt = t;
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(body);
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify(buildState()));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'viewport' && Number.isFinite(m.w) && Number.isFinite(m.h)) {
      const previous = jam.render(Date.now()).viewport;
      if (mousemux && (previous.w !== m.w || previous.h !== m.h)) mousemux.setEnabled(false);
      jam.setViewport(m.w, m.h);
    }
    else if (m.t === 'hide' && Number.isInteger(m.idx)) dispatchAll(jam.setHidden(m.idx, !!m.hidden, Date.now()), null);
    else if (m.t === 'jam') {
      if (mousemux) mousemux.setEnabled(m.on === true);
      else toRawmouse(m.on ? 'JAM 1' : 'JAM 0');
    }
    else if (m.t === 'input-pause' && mousemux) mousemux.setEnabled(false);
  });
  ws.on('close', () => { if (mousemux && wss.clients.size === 0) mousemux.setEnabled(false); });
});

// ------------------------------------------------------------------ main loop + shutdown
const tickTimer = setInterval(() => {
  dispatchAll(jam.tick(Date.now()), null);
  broadcast(false);
}, 16);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(tickTimer);
  if (mousemux) mousemux.stop();
  polling = false;
  stopAllListeners(); // leave Live with no listeners pointing at us
  setTimeout(() => {
    try { if (clientBridge) clientBridge.disconnect(); } catch (e) { /* ignore */ }
    if (osc) osc.close();
    for (const resource of [inSock, out, wss, server]) {
      try { resource.close(); } catch (e) { /* socket may never have been bound */ }
    }
    process.exit(0);
  }, 150);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown);

function listen() {
  server.listen(ARGS.port, '127.0.0.1', () => {
    log(`MultiMouse Jam server  mode=${MODE}  http://127.0.0.1:${ARGS.port}  udp-in=${ARGS.udpIn}  udp-out=${ARGS.udpOut}  sens=${ARGS.sens}`);
    if (mousemux) mousemux.start();
  });
}
if (mousemux) listen();
else inSock.bind(ARGS.udpIn, '127.0.0.1', listen);

if (ARGS.noAbleton) buildFake();
else {
  startOsc().then(() => {
    if (transport !== 'osc') log('transport: bridge (' + (oscNote || 'osc not started') + ')');
    connectLoop().then(() => { if (transport !== 'osc') transport = transport === 'none' ? 'bridge' : transport; });
    pollLoop();
  });
}

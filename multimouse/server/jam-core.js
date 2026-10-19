'use strict';
/**
 * jam-core.js - PURE module (no I/O, no timers, no clocks: every entry point takes `now` in ms).
 *
 * Turns wire-1 events (see contract.md) from any number of mice into:
 *   - per-player state (cursor, hover, selection, open menu, fader drag)
 *   - Ableton actions: [{ cmd, params, player, udp?, final? }]
 *   - a JSON-serialisable render state for the panel.
 *
 * Players are fully independent and simultaneous. The only shared mutable state is the grid scroll.
 */

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

const PLAYER_COLORS = ['#a78bfa', '#06b6d4', '#f59e0b', '#f472b6', '#34d399', '#fb923c', '#60a5fa', '#a3e635'];
const CLICK_TRAVEL_PX = 6;
const FADER_MIN_INTERVAL_MS = 34; // 1000/34 = 29.4 Hz, i.e. <= 30 Hz per track
const FLASH_MS = 450;
const HELLO_TIMEOUT_MS = 6000;
const IDLE_DROP_MS = 60000;
const MENU_SWATCHES = [14, 15, 17, 19, 22, 24]; // Live colour_index values: red orange yellow green blue purple
const DIMS = { sceneW: 84, headerH: 48, colW: 112, rowH: 34, stopH: 30, mixerMinH: 110, faderPadTop: 16, faderPadBottom: 48 };
const MENU_DIMS = { w: 172, head: 24, item: 28, colorRow: 36, swatch: 22, swatchGap: 4, swatchX: 10 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function playerColor(idx) {
  const n = PLAYER_COLORS.length;
  return PLAYER_COLORS[(((idx - 1) % n) + n) % n];
}

// Approximate Ableton Live palette (cosmetic only; the real colour_index is what is sent to Live).
const LIVE_ROW0 = ['#ff94a6', '#ffa529', '#cc9927', '#f7f47c', '#bffb00', '#1aff2f', '#25ffa8', '#5cffe8', '#8bc5ff', '#5480e4', '#92a7ff', '#d86ce4', '#e553a0', '#ffffff'];
const LIVE_ROW1 = ['#ff3636', '#f66c03', '#99724b', '#fff034', '#87ff67', '#3dc300', '#00bfaf', '#19e9ff', '#10a4ee', '#007dc0', '#886ce4', '#b677c6', '#ff39d4', '#d0d0d0'];

function mixHex(hex, other, amt) {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(other.slice(1), 16);
  const ch = (shift) => Math.round(((a >> shift) & 255) * (1 - amt) + ((b >> shift) & 255) * amt);
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}

function liveColor(index) {
  if (index == null || index < 0) return null;
  const i = Math.floor(index);
  const c = i % 14;
  const row = Math.floor(i / 14);
  if (row === 0) return LIVE_ROW0[c];
  if (row === 1) return LIVE_ROW1[c];
  if (row === 2) return mixHex(LIVE_ROW1[c], '#ffffff', 0.45);
  if (row === 3) return mixHex(LIVE_ROW1[c], '#000000', 0.4);
  return mixHex(LIVE_ROW0[c], '#808080', 0.5);
}

// ---------------------------------------------------------------------------------------------
// Wire-1 parsing
// ---------------------------------------------------------------------------------------------

/** Parse one wire-1 line. Returns an event object or null if malformed/unknown. */
function parseLine(line) {
  const s = String(line).replace(/\r$/, '').trim();
  if (!s) return null;
  const sp = s.split(' ');
  const k = sp[0];
  const int = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && Math.floor(n) === n ? n : null;
  };
  switch (k) {
    case 'HELLO': {
      const pid = int(sp[1]);
      return pid === null ? null : { k, pid, version: sp.slice(2).join(' ') };
    }
    case 'D': {
      const idx = int(sp[1]);
      if (idx === null) return null;
      if (sp[2] === 'add') return { k, idx, op: 'add', name: sp.slice(3).join(' ') };
      if (sp[2] === 'remove') return { k, idx, op: 'remove' };
      return null;
    }
    case 'M':
    case 'A': {
      const idx = int(sp[1]);
      const a = int(sp[2]);
      const b = int(sp[3]);
      if (idx === null || a === null || b === null) return null;
      return k === 'M' ? { k, idx, dx: a, dy: b } : { k, idx, x: a, y: b };
    }
    case 'B': {
      const idx = int(sp[1]);
      const down = int(sp[3]);
      if (idx === null || !['L', 'R', 'M', 'X1', 'X2'].includes(sp[2]) || (down !== 0 && down !== 1)) return null;
      return { k, idx, btn: sp[2], down: down === 1 };
    }
    case 'W':
    case 'H': {
      const idx = int(sp[1]);
      const delta = int(sp[2]);
      return idx === null || delta === null ? null : { k, idx, delta };
    }
    case 'J': {
      const on = int(sp[1]);
      return on === 0 || on === 1 ? { k, on: on === 1 } : null;
    }
    case 'PONG':
      return { k };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Session snapshot helpers
// ---------------------------------------------------------------------------------------------

/**
 * Session snapshot shape (built by server.js from AbletonBridge replies):
 * { ready, trackCount, sceneCount,
 *   scenes: [{name}], tracks: [{name, volume, color, mute, group}]  (sparse, by track index),
 *   slots:  [[{has, name}]]   (sparse, by track index; slots[t][s]),
 *   playing: { "t:s": "playing" | "triggered" } }
 */
function emptySession() {
  return { ready: false, trackCount: 0, sceneCount: 0, scenes: [], tracks: [], slots: [], playing: {} };
}

function slotInfo(session, t, s) {
  const row = session.slots[t];
  return row ? row[s] || null : null;
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

/**
 * Compute the panel layout. Pure: viewport + session counts + scroll offsets (in whole tracks/scenes).
 * Returns rects plus the clamped scroll actually used.
 */
function computeLayout(vw, vh, session, scroll) {
  const { sceneW, headerH, colW, rowH, stopH, mixerMinH } = DIMS;
  const nT = session.trackCount || 0;
  const nS = session.sceneCount || 0;
  const gridX = sceneW;
  const gridW = Math.max(colW, vw - sceneW);
  const visTracks = Math.max(1, Math.floor(gridW / colW));
  const rowsAvail = Math.max(1, Math.floor((vh - headerH - stopH - mixerMinH) / rowH));
  const sx = clamp(Math.round(scroll.tracks), 0, Math.max(0, nT - visTracks));
  const sy = clamp(Math.round(scroll.scenes), 0, Math.max(0, nS - rowsAvail));
  const trackCols = [];
  for (let i = 0; i < visTracks && sx + i < nT; i++) trackCols.push({ t: sx + i, x: gridX + i * colW, w: colW });
  const rows = [];
  for (let i = 0; i < rowsAvail && sy + i < nS; i++) rows.push({ s: sy + i, y: headerH + i * rowH, h: rowH });
  const stopY = headerH + rows.length * rowH;
  const mixerY = stopY + stopH;
  const mixerH = Math.max(mixerMinH, vh - mixerY);
  const gTop = mixerY + DIMS.faderPadTop;
  const gBot = mixerY + mixerH - DIMS.faderPadBottom;
  const faders = trackCols.map((c) => ({ t: c.t, x: c.x, w: c.w, cx: c.x + c.w / 2, y0: gTop, y1: gBot }));
  return {
    vw, vh, sceneW, headerH, colW, rowH, stopH,
    scroll: { tracks: sx, scenes: sy },
    visTracks, rowsAvail,
    trackCols, rows,
    stop: { y: stopY, h: stopH },
    mixer: { y: mixerY, h: mixerH },
    faders,
    grid: { x: gridX, y: headerH, w: trackCols.length * colW, h: rows.length * rowH },
  };
}

function colAt(layout, x) {
  for (const c of layout.trackCols) if (x >= c.x && x < c.x + c.w) return c;
  return null;
}
function rowAt(layout, y) {
  for (const r of layout.rows) if (y >= r.y && y < r.y + r.h) return r;
  return null;
}

/** What is under (x,y)? { type: 'slot'|'scene'|'header'|'stop'|'fader'|'none', t?, s? } */
function hitTest(layout, x, y) {
  const col = colAt(layout, x);
  if (y >= 0 && y < layout.headerH) return col ? { type: 'header', t: col.t } : { type: 'none' };
  const row = rowAt(layout, y);
  if (row) {
    if (col) return { type: 'slot', t: col.t, s: row.s };
    if (x >= 0 && x < layout.sceneW) return { type: 'scene', s: row.s };
    return { type: 'none' };
  }
  if (y >= layout.stop.y && y < layout.stop.y + layout.stop.h) return col ? { type: 'stop', t: col.t } : { type: 'none' };
  if (y >= layout.mixer.y && y < layout.vh) return col ? { type: 'fader', t: col.t } : { type: 'none' };
  return { type: 'none' };
}

/** Nearest slot cell to (x,y), clamping into the visible grid (used while a band drag leaves the grid). */
function cellClamped(layout, x, y) {
  if (!layout.trackCols.length || !layout.rows.length) return null;
  const first = layout.trackCols[0];
  const last = layout.trackCols[layout.trackCols.length - 1];
  const cx = clamp(x, first.x, last.x + last.w - 1);
  const cy = clamp(y, layout.rows[0].y, layout.rows[layout.rows.length - 1].y + layout.rowH - 1);
  const col = colAt(layout, cx);
  const row = rowAt(layout, cy);
  return col && row ? { t: col.t, s: row.s } : null;
}

function faderFor(layout, t) {
  return layout.faders.find((f) => f.t === t) || null;
}

/** Volume (0..1, Live's linear parameter value) for a pointer y on a fader. */
function volumeAtY(fader, y) {
  const v = (fader.y1 - y) / (fader.y1 - fader.y0);
  return Math.round(clamp(v, 0, 1) * 10000) / 10000;
}

// ---------------------------------------------------------------------------------------------
// Selection + menu geometry
// ---------------------------------------------------------------------------------------------

function normRect(a, b) {
  return { t0: Math.min(a.t, b.t), t1: Math.max(a.t, b.t), s0: Math.min(a.s, b.s), s1: Math.max(a.s, b.s) };
}
function inRect(r, t, s) {
  return !!r && t >= r.t0 && t <= r.t1 && s >= r.s0 && s <= r.s1;
}
function cellsOf(r) {
  const out = [];
  for (let t = r.t0; t <= r.t1; t++) for (let s = r.s0; s <= r.s1; s++) out.push({ t, s });
  return out;
}

function buildMenu(vw, vh, px, py, cells) {
  const D = MENU_DIMS;
  const label = cells.length === 1 ? `Track ${cells[0].t + 1}  Scene ${cells[0].s + 1}` : `${cells.length} slots`;
  const defs = [
    { id: 'head', label, h: D.head, inert: true },
    { id: 'fire', label: 'Fire', h: D.item },
    { id: 'stop', label: 'Stop', h: D.item },
    { id: 'duplicate', label: 'Duplicate', h: D.item },
    { id: 'color', label: 'Color', h: D.colorRow, swatches: MENU_SWATCHES.slice(), swatchColors: MENU_SWATCHES.map(liveColor) },
    { id: 'delete', label: 'Delete', h: D.item },
  ];
  const H = defs.reduce((a, d) => a + d.h, 0);
  const mx = clamp(px, 0, Math.max(0, vw - D.w));
  const my = clamp(py, 0, Math.max(0, vh - H));
  let y = my;
  const items = defs.map((d) => {
    const it = { ...d, y };
    y += d.h;
    return it;
  });
  return { x: mx, y: my, w: D.w, h: H, items, cells, hot: null };
}

/** Shift an open menu (and its item rows) so it lies inside a vw x vh viewport. */
function fitMenu(menu, vw, vh) {
  const nx = clamp(menu.x, 0, Math.max(0, vw - menu.w));
  const ny = clamp(menu.y, 0, Math.max(0, vh - menu.h));
  const dy = ny - menu.y;
  menu.x = nx; menu.y = ny;
  if (dy) for (const it of menu.items) it.y += dy;
}

/** Hit-test an open menu. Returns { id, swatch? } or null (outside / inert). */
function menuItemAt(menu, x, y) {
  if (!menu) return null;
  if (x < menu.x || x >= menu.x + menu.w || y < menu.y || y >= menu.y + menu.h) return null;
  const D = MENU_DIMS;
  for (const it of menu.items) {
    if (y < it.y || y >= it.y + it.h) continue;
    if (it.inert) return null;
    if (it.swatches) {
      const rel = x - (menu.x + D.swatchX);
      const i = Math.floor(rel / (D.swatch + D.swatchGap));
      const within = rel - i * (D.swatch + D.swatchGap) < D.swatch;
      return { id: 'color', swatch: rel >= 0 && within && i >= 0 && i < it.swatches.length ? i : -1 };
    }
    return { id: it.id };
  }
  return null;
}
function insideMenu(menu, x, y) {
  return !!menu && x >= menu.x && x < menu.x + menu.w && y >= menu.y && y < menu.y + menu.h;
}
function sameItem(a, b) {
  return !!a && !!b && a.id === b.id && (a.swatch || 0) === (b.swatch || 0);
}

// ---------------------------------------------------------------------------------------------
// The jam: all players + shared scroll
// ---------------------------------------------------------------------------------------------

function createJam(opts) {
  const o = Object.assign({ sensitivity: 0.6, viewport: { w: 1280, h: 720 } }, opts || {});
  const J = {
    vw: o.viewport.w,
    vh: o.viewport.h,
    sens: o.sensitivity,
    session: emptySession(),
    scroll: { tracks: 0, scenes: 0 },
    wheelAcc: { v: 0, h: 0 },
    devices: new Map(), // idx -> {idx,name,hidden}: every raw-input interface rawmouse lists (status bar only)
    colorOf: new Map(), // idx -> colour, assigned in order of first activity, stable afterwards
    players: new Map(), // idx -> player, created lazily on first M/A/B/W/H, dropped on remove or idle
    lastNow: 0,
    faders: new Map(), // track -> { lastSent, pending, value, override, overrideUntil }
    flashes: [],
    status: { jam: false, helloAt: null, pid: null, version: null },
    layout: null,
  };

  const getLayout = () => {
    if (!J.layout) {
      J.layout = computeLayout(J.vw, J.vh, J.session, J.scroll);
      J.scroll.tracks = J.layout.scroll.tracks;
      J.scroll.scenes = J.layout.scroll.scenes;
    }
    return J.layout;
  };
  const dirtyLayout = () => { J.layout = null; };

  const act = (out, p, cmd, params, extra) => out.push(Object.assign({ cmd, params, player: p.idx }, extra || {}));
  const flash = (p, now, f) => J.flashes.push(Object.assign({ color: p.color, until: now + FLASH_MS, player: p.idx }, f));

  const refreshHover = (p) => {
    p.hover = hitTest(getLayout(), p.x, p.y);
    if (p.menu) p.menu.hot = menuItemAt(p.menu, p.x, p.y);
  };

  // ---- fader (throttled, last value always sent on release)
  const faderState = (t) => {
    let st = J.faders.get(t);
    if (!st) { st = { lastSent: -Infinity, pending: null, value: null, overrideUntil: 0 }; J.faders.set(t, st); }
    return st;
  };
  const faderMove = (p, t, v, now, out) => {
    const st = faderState(t);
    st.value = v;
    st.override = v;
    st.overrideUntil = now + 2500;
    if (now - st.lastSent >= FADER_MIN_INTERVAL_MS) {
      st.lastSent = now;
      st.pending = null;
      act(out, p, 'set_track_volume', { track_index: t, volume: v }, { udp: true });
    } else {
      st.pending = { v, player: p.idx };
    }
  };
  const faderRelease = (p, t, now, out) => {
    const st = faderState(t);
    if (st.value === null) return;
    st.lastSent = now;
    st.pending = null;
    act(out, p, 'set_track_volume', { track_index: t, volume: st.value }, { udp: false, final: true });
  };

  // ---- menu actions
  const hasClip = (t, s) => {
    const si = slotInfo(J.session, t, s);
    return si ? !!si.has : null; // null = unknown
  };

  const runMenuItem = (p, item, now, out) => {
    const menu = p.menu;
    if (!menu) return;
    const cells = menu.cells;
    const clipCells = cells.filter((c) => hasClip(c.t, c.s) !== false);
    switch (item.id) {
      case 'fire':
        for (const c of clipCells) { act(out, p, 'fire_clip', { track_index: c.t, clip_index: c.s }); flash(p, now, { type: 'slot', t: c.t, s: c.s }); }
        break;
      case 'stop':
        for (const c of cells) { act(out, p, 'stop_clip', { track_index: c.t, clip_index: c.s }); flash(p, now, { type: 'slot', t: c.t, s: c.s }); }
        break;
      case 'duplicate': {
        const taken = new Set();
        const sorted = clipCells.slice().sort((a, b) => a.t - b.t || a.s - b.s);
        for (const c of sorted) {
          if (hasClip(c.t, c.s) !== true) continue; // target slot cannot be chosen without slot data
          let target = -1;
          for (let s = c.s + 1; s < J.session.sceneCount; s++) {
            if (hasClip(c.t, s) === false && !taken.has(c.t + ':' + s)) { target = s; break; }
          }
          if (target < 0) continue;
          taken.add(c.t + ':' + target);
          act(out, p, 'duplicate_clip', { track_index: c.t, clip_index: c.s, target_clip_index: target });
          flash(p, now, { type: 'slot', t: c.t, s: target });
        }
        break;
      }
      case 'color': {
        if (item.swatch < 0) return; // clicked the row gap: keep menu open
        const colorIndex = menu.items.find((i) => i.id === 'color').swatches[item.swatch];
        for (const c of clipCells) act(out, p, 'set_clip_color', { track_index: c.t, clip_index: c.s, color_index: colorIndex });
        break;
      }
      case 'delete':
        for (const c of clipCells) act(out, p, 'delete_clip', { track_index: c.t, clip_index: c.s });
        break;
      default:
        return;
    }
    p.menu = null;
  };

  // ---- player lifecycle
  const ensurePlayer = (idx, now) => {
    let p = J.players.get(idx);
    if (!p) {
      const dev = J.devices.get(idx);
      if (!dev || dev.hidden) return null;
      if (!J.colorOf.has(idx)) J.colorOf.set(idx, PLAYER_COLORS[J.colorOf.size % PLAYER_COLORS.length]);
      p = {
        idx, name: dev.name, color: J.colorOf.get(idx), hidden: false, lastEvent: now,
        x: clamp(J.vw / 2 + (J.players.size) * 40, 0, J.vw - 1), y: J.vh / 2,
        held: { L: false, R: false }, press: null, sel: null, band: null, menu: null, hover: { type: 'none' },
      };
      J.players.set(idx, p);
      refreshHover(p);
    }
    p.lastEvent = now;
    return p;
  };

  const releaseEverything = (p, now, out) => {
    // flush a fader drag in progress so Live ends on the last value
    if (p.press && p.press.mode === 'fader') faderRelease(p, p.press.t, now, out);
    p.press = null; p.held.L = false; p.held.R = false; p.menu = null; p.sel = null; p.band = null;
  };

  const removePlayer = (idx, now, out) => {
    const p = J.players.get(idx);
    if (!p) return;
    releaseEverything(p, now, out);
    J.players.delete(idx);
  };

  // ---- pointer handling
  const move = (p, x, y, now, out) => {
    p.x = clamp(x, 0, J.vw - 1);
    p.y = clamp(y, 0, J.vh - 1);
    refreshHover(p);
    const pr = p.press;
    if (!pr || !p.held.L) return;
    pr.travel = Math.max(pr.travel, Math.hypot(p.x - pr.x, p.y - pr.y));
    if (pr.mode === 'fader') {
      const f = faderFor(getLayout(), pr.t);
      if (f) faderMove(p, pr.t, volumeAtY(f, p.y), now, out);
    } else if (pr.mode === 'slot' || pr.mode === 'band') {
      if (pr.mode === 'slot' && pr.travel >= CLICK_TRAVEL_PX) {
        pr.mode = 'band';
        p.band = { anchor: { t: pr.hit.t, s: pr.hit.s } };
        p.sel = normRect(p.band.anchor, p.band.anchor);
      }
      if (pr.mode === 'band') {
        const c = cellClamped(getLayout(), p.x, p.y);
        if (c) p.sel = normRect(p.band.anchor, c);
      }
    }
  };

  const leftDown = (p, now, out) => {
    p.held.L = true;
    if (p.menu) {
      const item = menuItemAt(p.menu, p.x, p.y);
      if (item) p.press = { mode: 'menu', item, x: p.x, y: p.y, travel: 0 };
      else { p.menu = null; p.press = { mode: 'consumed', x: p.x, y: p.y, travel: 0 }; }
      return;
    }
    const hit = hitTest(getLayout(), p.x, p.y);
    const pr = { x: p.x, y: p.y, hit, travel: 0, mode: 'click' };
    if (hit.type === 'fader') {
      pr.mode = 'fader'; pr.t = hit.t;
      const f = faderFor(getLayout(), hit.t);
      if (f) faderMove(p, hit.t, volumeAtY(f, p.y), now, out);
    } else if (hit.type === 'slot') {
      pr.mode = 'slot';
    }
    p.press = pr;
  };

  const leftUp = (p, now, out) => {
    const pr = p.press;
    p.held.L = false;
    p.press = null;
    if (!pr) return;
    switch (pr.mode) {
      case 'menu': {
        const item = menuItemAt(p.menu, p.x, p.y);
        if (sameItem(item, pr.item)) runMenuItem(p, item, now, out);
        return;
      }
      case 'consumed':
        return;
      case 'fader':
        faderRelease(p, pr.t, now, out);
        return;
      case 'band':
        p.band = null; // selection stays until this player clicks elsewhere
        return;
      default:
        break;
    }
    if (pr.travel >= CLICK_TRAVEL_PX) return; // a drag that began off-slot is not a click
    p.sel = null; // a plain click anywhere clears this player's own selection
    const h = pr.hit;
    if (h.type === 'slot') {
      if (hasClip(h.t, h.s) === false) act(out, p, 'stop_clip', { track_index: h.t, clip_index: h.s }); // Live: firing an empty slot stops the track
      else act(out, p, 'fire_clip', { track_index: h.t, clip_index: h.s });
      flash(p, now, { type: 'slot', t: h.t, s: h.s });
    } else if (h.type === 'scene') {
      act(out, p, 'fire_scene', { scene_index: h.s });
      flash(p, now, { type: 'scene', s: h.s });
    } else if (h.type === 'header') {
      act(out, p, 'select_track', { track_index: h.t });
      flash(p, now, { type: 'header', t: h.t });
    } else if (h.type === 'stop') {
      act(out, p, 'stop_track_clips', { track_index: h.t });
      flash(p, now, { type: 'stop', t: h.t });
    }
  };

  const rightDown = (p) => {
    p.held.R = true;
    const hit = hitTest(getLayout(), p.x, p.y);
    if (hit.type !== 'slot') { p.menu = null; return; }
    const cells = inRect(p.sel, hit.t, hit.s) ? cellsOf(p.sel) : [{ t: hit.t, s: hit.s }];
    p.menu = buildMenu(J.vw, J.vh, p.x, p.y, cells);
    p.menu.hot = menuItemAt(p.menu, p.x, p.y);
  };

  const wheel = (axis, delta) => {
    if (axis === 'v') {
      J.wheelAcc.v += delta / 120;
      const n = Math.trunc(J.wheelAcc.v);
      J.wheelAcc.v -= n;
      if (n) { J.scroll.scenes -= n; dirtyLayout(); }
    } else {
      J.wheelAcc.h += delta / 120;
      const n = Math.trunc(J.wheelAcc.h);
      J.wheelAcc.h -= n;
      if (n) { J.scroll.tracks += n * 2; dirtyLayout(); }
    }
  };

  // ---- public API
  const api = {
    /** Apply one parsed wire-1 event. Returns the Ableton actions it produced. */
    handle(ev, now) {
      J.lastNow = now;
      const out = [];
      if (!ev) return out;
      switch (ev.k) {
        case 'HELLO':
          J.status.helloAt = now; J.status.pid = ev.pid; J.status.version = ev.version;
          break;
        case 'PONG':
          J.status.helloAt = J.status.helloAt === null ? now : J.status.helloAt;
          break;
        case 'J':
          J.status.jam = ev.on;
          break;
        case 'D':
          if (ev.op === 'add') {
            const old = J.devices.get(ev.idx);
            J.devices.set(ev.idx, { idx: ev.idx, name: ev.name, hidden: old ? old.hidden : false });
            const pl = J.players.get(ev.idx);
            if (pl) pl.name = ev.name;
          } else { J.devices.delete(ev.idx); removePlayer(ev.idx, now, out); }
          break;
        default: {
          const p = ensurePlayer(ev.idx, now);
          if (!p) break;
          if (ev.k === 'M') move(p, p.x + ev.dx * J.sens, p.y + ev.dy * J.sens, now, out);
          else if (ev.k === 'A') move(p, (ev.x / 65535) * (J.vw - 1), (ev.y / 65535) * (J.vh - 1), now, out);
          else if (ev.k === 'B') {
            if (ev.btn === 'L') (ev.down ? leftDown : leftUp)(p, now, out);
            else if (ev.btn === 'R') { if (ev.down) rightDown(p); else p.held.R = false; }
          } else if (ev.k === 'W') wheel('v', ev.delta);
          else if (ev.k === 'H') wheel('h', ev.delta);
        }
      }
      return out;
    },

    handleLine(line, now) { return api.handle(parseLine(line), now); },

    /** A datagram may hold several \n-terminated lines. */
    handleDatagram(text, now) {
      const out = [];
      for (const line of String(text).split('\n')) out.push(...api.handleLine(line, now));
      return out;
    },

    /** Flush throttled fader values whose interval has elapsed; expire flashes. */
    tick(now) {
      const out = [];
      for (const [t, st] of J.faders) {
        if (st.pending && now - st.lastSent >= FADER_MIN_INTERVAL_MS) {
          st.lastSent = now;
          const pl = J.players.get(st.pending.player) || { idx: st.pending.player };
          act(out, pl, 'set_track_volume', { track_index: t, volume: st.pending.v }, { udp: true });
          st.pending = null;
        }
      }
      J.lastNow = now;
      for (const p of Array.from(J.players.values())) {
        if (now - p.lastEvent > IDLE_DROP_MS && !p.held.L && !p.held.R && !p.menu) removePlayer(p.idx, now, out);
      }
      J.flashes = J.flashes.filter((f) => f.until > now);
      return out;
    },

    setViewport(w, h) {
      w = Math.max(320, Math.floor(w)); h = Math.max(240, Math.floor(h));
      if (w === J.vw && h === J.vh) return;
      J.vw = w; J.vh = h; dirtyLayout();
      for (const p of J.players.values()) { p.x = clamp(p.x, 0, w - 1); p.y = clamp(p.y, 0, h - 1); if (p.menu) fitMenu(p.menu, w, h); refreshHover(p); }
    },

    setSession(patch) {
      Object.assign(J.session, patch);
      dirtyLayout();
      for (const p of J.players.values()) refreshHover(p);
    },

    setPlaying(map) { J.session.playing = map; },

    setHidden(idx, hidden, now) {
      const dev = J.devices.get(idx);
      if (!dev) return [];
      const out = [];
      dev.hidden = !!hidden;
      if (hidden) removePlayer(idx, now, out);
      return out;
    },

    setCursor(idx, x, y) {
      const p = ensurePlayer(idx, J.lastNow);
      if (!p) return;
      p.x = clamp(x, 0, J.vw - 1); p.y = clamp(y, 0, J.vh - 1);
      refreshHover(p);
    },

    player(idx) { return J.players.get(idx) || null; },
    get layout() { return getLayout(); },
    get scroll() { getLayout(); return Object.assign({}, J.scroll); },
    get session() { return J.session; },
    get statusRaw() { return J.status; },
    get viewport() { return { w: J.vw, h: J.vh }; },
    /** Visible clip-slot window the poller should keep fresh. */
    visibleTracks() { return getLayout().trackCols.map((c) => c.t); },

    /** JSON-serialisable state for the panel. */
    render(now) {
      const L = getLayout();
      const S = J.session;
      const volOf = (t) => {
        const st = J.faders.get(t);
        if (st && st.override !== undefined && now < st.overrideUntil) return st.override;
        const tr = S.tracks[t];
        return tr && typeof tr.volume === 'number' ? tr.volume : null;
      };
      const tracks = L.trackCols.map((c) => {
        const tr = S.tracks[c.t] || {};
        return {
          t: c.t, x: c.x, w: c.w, name: tr.name || ('Track ' + (c.t + 1)), color: liveColor(tr.color),
          volume: volOf(c.t), mute: !!tr.mute, group: !!tr.group,
        };
      });
      const cells = [];
      for (const r of L.rows) {
        for (const c of L.trackCols) {
          const si = slotInfo(S, c.t, r.s);
          cells.push({ t: c.t, s: r.s, has: si ? !!si.has : null, name: si && si.has ? si.name || '' : '', st: S.playing[c.t + ':' + r.s] || null });
        }
      }
      const players = [];
      const devices = [];
      for (const d of J.devices.values()) {
        const m = /VID_([0-9A-Fa-f]{4}).*?PID_([0-9A-Fa-f]{4})(?:.*?MI_([0-9A-Fa-f]{2}))?/.exec(d.name);
        devices.push({
          idx: d.idx, name: d.name, hidden: d.hidden, active: J.players.has(d.idx), color: J.colorOf.get(d.idx) || null,
          short: m ? (m[1] + ':' + m[2] + (m[3] ? ' MI_' + m[3] : '')).toUpperCase() : d.name,
        });
      }
      for (const p of J.players.values()) {
        players.push({
          idx: p.idx, name: p.name, color: p.color, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
          down: { L: p.held.L, R: p.held.R }, hover: p.hover,
          sel: p.sel, band: !!p.band || !!(p.press && p.press.mode === 'band'),
          faderT: p.press && p.press.mode === 'fader' ? p.press.t : null,
          menu: p.menu ? { x: p.menu.x, y: p.menu.y, w: p.menu.w, h: p.menu.h, items: p.menu.items, hot: p.menu.hot, count: p.menu.cells.length } : null,
        });
      }
      const hello = J.status.helloAt;
      return {
        t: 'state',
        now,
        viewport: { w: J.vw, h: J.vh },
        status: {
          jam: J.status.jam,
          rawmouse: { seen: hello !== null && now - hello < HELLO_TIMEOUT_MS, pid: J.status.pid, version: J.status.version },
          session: { ready: !!S.ready, trackCount: S.trackCount, sceneCount: S.sceneCount },
        },
        layout: {
          sceneW: L.sceneW, headerH: L.headerH, colW: L.colW, rowH: L.rowH, stop: L.stop, mixer: L.mixer,
          rows: L.rows.map((r) => ({ s: r.s, y: r.y, h: r.h, name: (S.scenes[r.s] && S.scenes[r.s].name) || '' })),
          faders: L.faders, scroll: L.scroll, totalTracks: S.trackCount, totalScenes: S.sceneCount,
        },
        tracks, cells, players, devices,
        flashes: J.flashes.map((f) => ({ type: f.type, t: f.t, s: f.s, color: f.color, left: f.until - now })),
      };
    },
  };
  return api;
}

module.exports = {
  createJam, parseLine, computeLayout, hitTest, cellClamped, volumeAtY, buildMenu, menuItemAt, insideMenu,
  liveColor, playerColor, emptySession, slotInfo, normRect, cellsOf,
  PLAYER_COLORS, IDLE_DROP_MS, CLICK_TRAVEL_PX, FADER_MIN_INTERVAL_MS, FLASH_MS, HELLO_TIMEOUT_MS, MENU_SWATCHES, DIMS, MENU_DIMS,
};

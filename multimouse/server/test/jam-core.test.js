'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../jam-core');

const VW = 1280;
const VH = 720;

/** 12 tracks x 8 scenes. Clips: t0 s0,s1 ; t1 s0 ; t2 s0..s2 ; t3 s0. Everything else known-empty. */
function makeSession() {
  const clipsAt = { 0: [0, 1], 1: [0], 2: [0, 1, 2], 3: [0] };
  const slots = [];
  const tracks = [];
  for (let t = 0; t < 12; t++) {
    tracks[t] = { name: 'T' + t, volume: 0.85, color: t };
    slots[t] = [];
    for (let s = 0; s < 8; s++) {
      const has = (clipsAt[t] || []).includes(s);
      slots[t][s] = { has, name: has ? `clip ${t}.${s}` : '' };
    }
  }
  return { ready: true, trackCount: 12, sceneCount: 8, scenes: Array.from({ length: 8 }, (_, i) => ({ name: 'S' + i })), tracks, slots, playing: {} };
}

function makeJam() {
  const jam = core.createJam({ sensitivity: 1, viewport: { w: VW, h: VH } });
  jam.setSession(makeSession());
  jam.handleDatagram('HELLO 4242 1.0\nD 1 add Mouse A\nD 2 add Mouse B\n', 0);
  jam.handleLine('M 1 0 0', 0); // players are created lazily on first activity
  jam.handleLine('M 2 0 0', 0);
  return jam;
}

// cell centre in px for track t, scene s at scroll 0 (colW 112, sceneW 84, headerH 48, rowH 34)
const cx = (t) => 84 + t * 112 + 56;
const cy = (s) => 48 + s * 34 + 17;

/** Move device idx so its cursor lands at (x,y): teleport then ask the core to refresh hover via a zero move. */
function put(jam, idx, x, y) {
  jam.setCursor(idx, x, y);
}
const ev = (jam, line, now) => jam.handleLine(line, now);

test('parseLine understands every wire-1 line and rejects garbage', () => {
  assert.deepEqual(core.parseLine('HELLO 123 0.1'), { k: 'HELLO', pid: 123, version: '0.1' });
  assert.deepEqual(core.parseLine('D 3 add HID\\VID_046D&PID_C077 mouse'), { k: 'D', idx: 3, op: 'add', name: 'HID\\VID_046D&PID_C077 mouse' });
  assert.deepEqual(core.parseLine('D 3 remove'), { k: 'D', idx: 3, op: 'remove' });
  assert.deepEqual(core.parseLine('M 1 -4 7'), { k: 'M', idx: 1, dx: -4, dy: 7 });
  assert.deepEqual(core.parseLine('A 2 65535 0'), { k: 'A', idx: 2, x: 65535, y: 0 });
  assert.deepEqual(core.parseLine('B 1 R 1'), { k: 'B', idx: 1, btn: 'R', down: true });
  assert.deepEqual(core.parseLine('B 1 X2 0'), { k: 'B', idx: 1, btn: 'X2', down: false });
  assert.deepEqual(core.parseLine('W 1 -120'), { k: 'W', idx: 1, delta: -120 });
  assert.deepEqual(core.parseLine('H 1 120'), { k: 'H', idx: 1, delta: 120 });
  assert.deepEqual(core.parseLine('J 1'), { k: 'J', on: true });
  assert.deepEqual(core.parseLine('PONG\r'), { k: 'PONG' });
  for (const bad of ['', 'M 1 x 2', 'B 1 Q 1', 'B 1 L 2', 'J 5', 'ZZZ 1', 'D x add n', 'M 1 2']) assert.equal(core.parseLine(bad), null, bad);
});

test('layout and hit testing', () => {
  const jam = makeJam();
  const L = jam.layout;
  assert.equal(L.visTracks, 10);
  assert.equal(L.rows.length, 8);
  assert.deepEqual(core.hitTest(L, cx(2), cy(3)), { type: 'slot', t: 2, s: 3 });
  assert.deepEqual(core.hitTest(L, 40, cy(5)), { type: 'scene', s: 5 });
  assert.deepEqual(core.hitTest(L, cx(4), 20), { type: 'header', t: 4 });
  assert.deepEqual(core.hitTest(L, cx(1), L.stop.y + 5), { type: 'stop', t: 1 });
  assert.deepEqual(core.hitTest(L, cx(6), L.mixer.y + 40), { type: 'fader', t: 6 });
  assert.deepEqual(core.hitTest(L, 10, 10), { type: 'none' });
});

test('click on a clip slot fires exactly that clip', () => {
  const jam = makeJam();
  put(jam, 1, cx(2), cy(1));
  assert.deepEqual(ev(jam, 'B 1 L 1', 10), []);
  const acts = ev(jam, 'B 1 L 0', 60);
  assert.deepEqual(acts, [{ cmd: 'fire_clip', params: { track_index: 2, clip_index: 1 }, player: 1 }]);
});

test('click with small jitter (<6px) still fires; a 10px drag does not fire', () => {
  const jam = makeJam();
  put(jam, 1, cx(0), cy(0));
  ev(jam, 'B 1 L 1', 0);
  ev(jam, 'M 1 3 2', 5);
  assert.equal(ev(jam, 'B 1 L 0', 10).length, 1);
  put(jam, 1, cx(0), cy(0));
  ev(jam, 'B 1 L 1', 20);
  ev(jam, 'M 1 10 0', 25); // starts a band, never a click
  assert.deepEqual(ev(jam, 'B 1 L 0', 30), []);
  assert.ok(jam.player(1).sel, 'band selection kept');
});

test('click on empty known slot sends stop_clip (fire_clip would error in Live)', () => {
  const jam = makeJam();
  put(jam, 1, cx(5), cy(5));
  ev(jam, 'B 1 L 1', 0);
  assert.deepEqual(ev(jam, 'B 1 L 0', 5), [{ cmd: 'stop_clip', params: { track_index: 5, clip_index: 5 }, player: 1 }]);
});

test('scene launch, track header and stop cell map to the right commands', () => {
  const jam = makeJam();
  const click = (idx, x, y, now) => { put(jam, idx, x, y); ev(jam, `B ${idx} L 1`, now); return ev(jam, `B ${idx} L 0`, now + 5); };
  assert.deepEqual(click(1, 40, cy(3), 0), [{ cmd: 'fire_scene', params: { scene_index: 3 }, player: 1 }]);
  assert.deepEqual(click(2, cx(7), 20, 100), [{ cmd: 'select_track', params: { track_index: 7 }, player: 2 }]);
  assert.deepEqual(click(1, cx(4), jam.layout.stop.y + 10, 200), [{ cmd: 'stop_track_clips', params: { track_index: 4 }, player: 1 }]);
});

test('two simultaneous, independent rubber-band selections', () => {
  const jam = makeJam();
  put(jam, 1, cx(0), cy(0));
  put(jam, 2, cx(6), cy(2));
  ev(jam, 'B 1 L 1', 0);
  ev(jam, 'B 2 L 1', 1);
  // interleaved motion
  for (let i = 0; i < 4; i++) {
    ev(jam, 'M 1 56 17', 10 + i * 10); // p1 walks down-right
    ev(jam, 'M 2 -30 25', 11 + i * 10); // p2 walks down-left
  }
  const s1 = jam.player(1).sel;
  const s2 = jam.player(2).sel;
  assert.ok(s1 && s2);
  // p1: from (t0,s0) towards (cx(0)+224, cy(0)+68) -> t2, s2
  assert.deepEqual(s1, { t0: 0, t1: 2, s0: 0, s1: 2 });
  // p2: from (t6,s2) towards (cx(6)-120, cy(2)+100) -> t5 (x=cx(6)-120 sits in t5), s5
  assert.equal(s2.t1, 6);
  assert.ok(s2.t0 < 6 && s2.s1 > 2 && s2.s0 === 2, JSON.stringify(s2));
  assert.deepEqual(s1, jam.player(1).sel, 'p1 untouched by p2 motion');
  ev(jam, 'B 1 L 0', 100);
  ev(jam, 'B 2 L 0', 101);
  assert.deepEqual(jam.player(1).sel, s1, 'selection survives release');
  assert.deepEqual(jam.player(2).sel, s2);
  // p1 clicks elsewhere: only p1's selection goes away
  put(jam, 1, 40, cy(7));
  ev(jam, 'B 1 L 1', 200);
  ev(jam, 'B 1 L 0', 205);
  assert.equal(jam.player(1).sel, null);
  assert.deepEqual(jam.player(2).sel, s2);
});

test('band drag leaving the grid clamps to the nearest cell', () => {
  const jam = makeJam();
  put(jam, 1, cx(1), cy(1));
  ev(jam, 'B 1 L 1', 0);
  ev(jam, 'M 1 0 30', 5);
  ev(jam, 'M 1 5000 5000', 10); // clamped to viewport, far bottom-right
  const sel = jam.player(1).sel;
  assert.equal(sel.t0, 1);
  assert.equal(sel.t1, 9); // last visible track column
  assert.equal(sel.s1, 7); // last scene row
});

test('two simultaneous context menus, independent dismissal and picking', () => {
  const jam = makeJam();
  put(jam, 1, cx(0), cy(0));
  put(jam, 2, cx(2), cy(1));
  ev(jam, 'B 1 R 1', 0);
  ev(jam, 'B 2 R 1', 1);
  ev(jam, 'B 1 R 0', 50);
  ev(jam, 'B 2 R 0', 51);
  const m1 = jam.player(1).menu;
  const m2 = jam.player(2).menu;
  assert.ok(m1 && m2, 'both menus open at once');
  assert.deepEqual(m1.cells, [{ t: 0, s: 0 }]);
  assert.deepEqual(m2.cells, [{ t: 2, s: 1 }]);
  assert.equal(jam.player(1).menu.x, cx(0));
  assert.equal(jam.player(2).menu.x, cx(2));

  // player 2 picks Fire on its own menu: only its action, p1 menu untouched
  const fireItem = m2.items.find((i) => i.id === 'fire');
  jam.setCursor(2, m2.x + 20, fireItem.y + 5);
  ev(jam, 'B 2 L 1', 100);
  const acts = ev(jam, 'B 2 L 0', 105);
  assert.deepEqual(acts, [{ cmd: 'fire_clip', params: { track_index: 2, clip_index: 1 }, player: 2 }]);
  assert.equal(jam.player(2).menu, null);
  assert.ok(jam.player(1).menu, 'p1 menu still open');

  // p2 left-clicking somewhere does not dismiss p1's menu; p1 clicking outside dismisses it and does not fire
  put(jam, 2, cx(8), cy(6));
  ev(jam, 'B 2 L 1', 200); ev(jam, 'B 2 L 0', 205);
  assert.ok(jam.player(1).menu);
  put(jam, 1, cx(9), cy(7));
  ev(jam, 'B 1 L 1', 300);
  assert.deepEqual(ev(jam, 'B 1 L 0', 305), []);
  assert.equal(jam.player(1).menu, null);
});

test('menu acts on the selection when the cursor is inside it, else on the slot under the cursor', () => {
  const jam = makeJam();
  // p1 selects t0..t1 x s0..s1 by band
  put(jam, 1, cx(0), cy(0));
  ev(jam, 'B 1 L 1', 0);
  ev(jam, 'M 1 112 34', 5);
  ev(jam, 'B 1 L 0', 10);
  assert.deepEqual(jam.player(1).sel, { t0: 0, t1: 1, s0: 0, s1: 1 });
  // right click inside selection -> menu covers all 4 cells
  put(jam, 1, cx(1), cy(1));
  ev(jam, 'B 1 R 1', 20);
  assert.equal(jam.player(1).menu.cells.length, 4);
  // choose Delete -> only cells that hold clips: t0s0, t0s1, t1s0
  const del = jam.player(1).menu.items.find((i) => i.id === 'delete');
  jam.setCursor(1, jam.player(1).menu.x + 10, del.y + 3);
  ev(jam, 'B 1 L 1', 30);
  const acts = ev(jam, 'B 1 L 0', 35);
  assert.deepEqual(acts.map((a) => [a.cmd, a.params.track_index, a.params.clip_index]).sort(), [
    ['delete_clip', 0, 0], ['delete_clip', 0, 1], ['delete_clip', 1, 0],
  ]);
  // right click OUTSIDE the selection -> only that slot
  put(jam, 1, cx(2), cy(2));
  ev(jam, 'B 1 R 1', 50);
  assert.deepEqual(jam.player(1).menu.cells, [{ t: 2, s: 2 }]);
  // colour swatch -> set_clip_color with a Live colour index
  const colorRow = jam.player(1).menu.items.find((i) => i.id === 'color');
  jam.setCursor(1, jam.player(1).menu.x + core.MENU_DIMS.swatchX + 4 + 2 * (core.MENU_DIMS.swatch + core.MENU_DIMS.swatchGap), colorRow.y + 18);
  ev(jam, 'B 1 L 1', 60);
  assert.deepEqual(ev(jam, 'B 1 L 0', 65), [{ cmd: 'set_clip_color', params: { track_index: 2, clip_index: 2, color_index: core.MENU_SWATCHES[2] }, player: 1 }]);
});

test('menu Duplicate targets the next empty slot on the same track; Stop acts on empty cells too', () => {
  const jam = makeJam();
  put(jam, 1, cx(2), cy(0)); // t2 has clips at s0,s1,s2
  ev(jam, 'B 1 R 1', 0);
  const m = jam.player(1).menu;
  const dup = m.items.find((i) => i.id === 'duplicate');
  jam.setCursor(1, m.x + 10, dup.y + 3);
  ev(jam, 'B 1 L 1', 10);
  assert.deepEqual(ev(jam, 'B 1 L 0', 15), [{ cmd: 'duplicate_clip', params: { track_index: 2, clip_index: 0, target_clip_index: 3 }, player: 1 }]);
});

test('fader drag: throttled to <=30 Hz, final value always sent on release', () => {
  const jam = makeJam();
  const f = jam.layout.faders.find((x) => x.t === 3);
  put(jam, 1, f.cx, f.y1 - 10);
  const all = [];
  all.push(...ev(jam, 'B 1 L 1', 1000));
  // 100 motion events, 1 ms apart, each nudging up 1 px
  for (let i = 0; i < 100; i++) all.push(...ev(jam, 'M 1 0 -1', 1001 + i));
  assert.ok(all.length <= 4, `too many in 100 ms: ${all.length}`);
  assert.ok(all.every((a) => a.cmd === 'set_track_volume' && a.params.track_index === 3 && a.udp === true));
  const end = [];
  end.push(...jam.tick(1101));
  end.push(...ev(jam, 'B 1 L 0', 1102));
  const final = end[end.length - 1];
  assert.equal(final.final, true);
  assert.equal(final.udp, false);
  const expected = core.volumeAtY(f, f.y1 - 10 - 100);
  assert.equal(final.params.volume, expected);
  // sustained 1 s drag at 1 kHz: count <= ~30 + final
  const jam2 = makeJam();
  put(jam2, 1, f.cx, f.y1 - 10);
  let n = 0;
  n += jam2.handleLine('B 1 L 1', 0).filter((a) => !a.final).length;
  for (let ms = 1; ms <= 1000; ms++) {
    n += jam2.handleLine('M 1 0 ' + (ms % 2 ? -1 : 1), ms).filter((a) => !a.final).length;
    n += jam2.tick(ms).filter((a) => !a.final).length;
  }
  assert.ok(n <= 30, `throttle exceeded: ${n}/s`);
  assert.ok(n >= 25, `throttle starved: ${n}/s`);
});

test('two faders dragged at once keep separate throttles and final values', () => {
  const jam = makeJam();
  const fa = jam.layout.faders.find((x) => x.t === 1);
  const fb = jam.layout.faders.find((x) => x.t === 5);
  put(jam, 1, fa.cx, fa.y0 + 100);
  put(jam, 2, fb.cx, fb.y0 + 200);
  const acts = [];
  acts.push(...ev(jam, 'B 1 L 1', 0), ...ev(jam, 'B 2 L 1', 0));
  assert.deepEqual(acts.map((a) => a.params.track_index).sort(), [1, 5], 'each fader gets its first value immediately');
  for (let i = 1; i <= 5; i++) { acts.push(...ev(jam, 'M 1 0 -10', i)); acts.push(...ev(jam, 'M 2 0 10', i)); }
  const rel = [...ev(jam, 'B 1 L 0', 10), ...ev(jam, 'B 2 L 0', 10)];
  const f1 = rel.find((a) => a.params.track_index === 1);
  const f2 = rel.find((a) => a.params.track_index === 5);
  assert.equal(f1.params.volume, core.volumeAtY(fa, fa.y0 + 100 - 50));
  assert.equal(f2.params.volume, core.volumeAtY(fb, fb.y0 + 200 + 50));
  assert.ok(f1.player === 1 && f2.player === 2);
});

test('fader volume maps top=1, bottom=0 and clamps', () => {
  const jam = makeJam();
  const f = jam.layout.faders[0];
  assert.equal(core.volumeAtY(f, f.y0 - 50), 1);
  assert.equal(core.volumeAtY(f, f.y1 + 50), 0);
  assert.equal(core.volumeAtY(f, (f.y0 + f.y1) / 2), 0.5);
});

test('one physical mouse listed as three interfaces, motion on one idx -> exactly one player', () => {
  const jam = core.createJam({ sensitivity: 1 });
  jam.handleDatagram([
    'HELLO 1 0.1',
    'D 1 add \\\\?\\HID#VID_1038&PID_161C&MI_00#7&abc',
    'D 2 add \\\\?\\HID#VID_1038&PID_161C&MI_02#7&abc',
    'D 3 add \\\\?\\HID#VID_1038&PID_161C&MI_03#7&abc',
    'D 4 add \\\\?\\HID#VID_3151&PID_3020#8&def',
  ].join('\n') + '\n', 0);
  assert.equal(jam.render(1).players.length, 0, 'no player from D lines alone');
  const devs = jam.render(1).devices;
  assert.equal(devs.length, 4);
  assert.equal(devs[1].short, '1038:161C MI_02');
  assert.equal(devs[3].short, '3151:3020');
  assert.ok(devs.every((d) => !d.active && d.color === null));
  jam.handleLine('M 2 5 5', 10);
  const st = jam.render(11);
  assert.deepEqual(st.players.map((p) => p.idx), [2]);
  assert.equal(st.devices.filter((d) => d.active).length, 1);
});

test('players are created lazily, colours follow first activity and stay stable, D remove drops, idle drops', () => {
  const jam = core.createJam({ sensitivity: 1 });
  for (let i = 1; i <= 3; i++) jam.handleLine('D ' + i + ' add dev' + i, 0);
  jam.handleLine('W 3 120', 1); // wheel counts as activity
  jam.handleLine('M 1 1 1', 2);
  assert.equal(jam.player(3).color, core.PLAYER_COLORS[0], 'first active gets first colour');
  assert.equal(jam.player(1).color, core.PLAYER_COLORS[1]);
  assert.equal(jam.player(2), null);
  jam.handleLine('D 3 remove', 3);
  assert.equal(jam.player(3), null);
  assert.equal(jam.render(4).devices.length, 2);
  jam.handleLine('D 3 add dev3', 5);
  jam.handleLine('M 3 1 1', 6);
  assert.equal(jam.player(3).color, core.PLAYER_COLORS[0], 'same idx, same colour');
  // idle drop after 60 s without events (idx 1 last active at t=2)
  jam.handleLine('M 3 1 1', 60000);
  jam.tick(core.IDLE_DROP_MS + 100);
  assert.equal(jam.player(1), null, 'idle player dropped');
  assert.ok(jam.player(3), 'recently active player kept');
  jam.handleLine('M 1 1 1', 62000);
  assert.equal(jam.player(1).color, core.PLAYER_COLORS[1], 'comes back with its colour');
  assert.equal(jam.handleLine('M 99 5 5', 3).length, 0, 'unknown idx ignored');
  assert.equal(jam.player(99), null);
});

test('removing a device mid fader-drag flushes its final value and drops its menu/selection', () => {
  const jam = makeJam();
  const f = jam.layout.faders.find((x) => x.t === 2);
  put(jam, 2, f.cx, f.y0 + 50);
  ev(jam, 'B 2 L 1', 0);
  ev(jam, 'M 2 0 20', 40);
  const acts = ev(jam, 'D 2 remove', 50);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].final, true);
  assert.equal(jam.player(2), null);
});

test('hidden devices are ignored and release anything held', () => {
  const jam = makeJam();
  put(jam, 2, cx(0), cy(0));
  ev(jam, 'B 2 R 1', 0);
  assert.ok(jam.player(2).menu);
  jam.setHidden(2, true, 5);
  assert.equal(jam.player(2), null, "hiding drops the player and its menu");
  assert.equal(ev(jam, "M 2 50 50", 6).length, 0);
  assert.equal(jam.player(2), null, "hidden device never becomes a player");
  assert.equal(jam.render(10).players.length, 1);
  assert.equal(jam.render(10).devices.find((d) => d.idx === 2).hidden, true);
  jam.setHidden(2, false, 20);
  ev(jam, 'M 2 10 0', 21);
  assert.equal(jam.render(30).players.length, 2);
});

test('wheel scrolls the shared grid; horizontal wheel scrolls tracks; clamped', () => {
  const jam = core.createJam({ sensitivity: 1, viewport: { w: 640, h: 400 } });
  jam.setSession(makeSession());
  jam.handleLine('D 1 add m', 0);
  jam.handleLine('D 2 add m2', 0);
  // 640x400: visTracks = floor((640-84)/112)=4 ; rowsAvail = floor((400-48-30-110)/34)=6 ; 8 scenes
  assert.equal(jam.layout.visTracks, 4);
  assert.equal(jam.layout.rowsAvail, 6);
  assert.equal(jam.layout.rows.length, 6);
  jam.handleLine('W 1 -120', 0); // towards user = scroll down
  assert.equal(jam.scroll.scenes, 1);
  jam.handleLine('W 2 -120', 1); // another player, same shared scroll
  jam.handleLine('W 2 -120', 2);
  assert.equal(jam.scroll.scenes, 2, 'clamped to nSc - rows = 2');
  assert.equal(jam.layout.rows[0].s, 2);
  jam.handleLine('W 1 120', 3);
  assert.equal(jam.scroll.scenes, 1);
  jam.handleLine('H 1 120', 4);
  assert.equal(jam.scroll.tracks, 2);
  for (let i = 0; i < 10; i++) jam.handleLine('H 2 120', 5 + i);
  assert.equal(jam.scroll.tracks, 8, 'clamped to 12-4');
  assert.equal(jam.layout.trackCols[0].t, 8);
  // hover and click follow the scrolled layout
  jam.setCursor(1, 84 + 56, 48 + 17);
  jam.handleLine('B 1 L 1', 100);
  const a = jam.handleLine('B 1 L 0', 105);
  assert.deepEqual(a.map((x) => x.params), [{ track_index: 8, clip_index: 1 }]);
  // hi-res wheel deltas accumulate
  const jam2 = core.createJam({ sensitivity: 1, viewport: { w: 640, h: 400 } });
  jam2.setSession(makeSession());
  jam2.handleLine('D 1 add m', 0);
  for (let i = 0; i < 4; i++) jam2.handleLine('W 1 -30', i);
  assert.equal(jam2.scroll.scenes, 1);
});

test('relative motion uses sensitivity and clamps; absolute events map across the viewport', () => {
  const jam = core.createJam({ sensitivity: 0.5, viewport: { w: 1000, h: 500 } });
  jam.handleLine('D 1 add m', 0);
  jam.setCursor(1, 100, 100);
  jam.handleLine('M 1 40 -20', 1);
  assert.equal(jam.player(1).x, 120);
  assert.equal(jam.player(1).y, 90);
  jam.handleLine('M 1 -99999 99999', 2);
  assert.equal(jam.player(1).x, 0);
  assert.equal(jam.player(1).y, 499);
  jam.handleLine('D 2 add abs', 3);
  jam.handleLine('A 2 65535 32768', 4);
  assert.equal(jam.player(2).x, 999);
  assert.ok(Math.abs(jam.player(2).y - 249.5) < 1);
});

test('status: hello heartbeat and jam flag', () => {
  const jam = core.createJam({});
  assert.equal(jam.render(0).status.rawmouse.seen, false);
  jam.handleLine('HELLO 55 0.3', 1000);
  assert.equal(jam.render(2000).status.rawmouse.seen, true);
  assert.equal(jam.render(2000).status.rawmouse.pid, 55);
  assert.equal(jam.render(1000 + core.HELLO_TIMEOUT_MS + 1).status.rawmouse.seen, false);
  assert.equal(jam.render(0).status.jam, false);
  jam.handleLine('J 1', 0);
  assert.equal(jam.render(0).status.jam, true);
});

test('render state is JSON-serialisable and contains per-player own selection and menu', () => {
  const jam = makeJam();
  put(jam, 1, cx(0), cy(0));
  ev(jam, 'B 1 L 1', 0); ev(jam, 'M 1 112 34', 5); ev(jam, 'B 1 L 0', 10);
  put(jam, 2, cx(3), cy(0));
  ev(jam, 'B 2 R 1', 20);
  const st = JSON.parse(JSON.stringify(jam.render(30)));
  const p1 = st.players.find((p) => p.idx === 1);
  const p2 = st.players.find((p) => p.idx === 2);
  assert.ok(p1.sel && !p1.menu);
  assert.ok(p2.menu && !p2.sel);
  assert.equal(st.cells.length, 10 * 8);
  assert.equal(st.cells.find((c) => c.t === 0 && c.s === 0).has, true);
});

test('menus, selections and fader drags survive viewport changes; menus are clamped, not closed', () => {
  const jam = makeJam();
  put(jam, 1, cx(0), cy(0));
  put(jam, 2, cx(9), cy(7));
  ev(jam, 'B 1 R 1', 0);
  ev(jam, 'B 2 R 1', 1);
  const sel1 = { t0: 0, t1: 0, s0: 0, s1: 0 };
  jam.player(1).sel = sel1;
  jam.setViewport(1720, 1000);
  assert.ok(jam.player(1).menu && jam.player(2).menu, 'both menus still open after enlarge');
  jam.setViewport(700, 420);
  const m2 = jam.player(2).menu;
  assert.ok(jam.player(1).menu && m2, 'both menus still open after shrink');
  assert.ok(m2.x + m2.w <= 700 && m2.y + m2.h <= 420, 'menu clamped into the new viewport');
  const head = m2.items[0];
  assert.equal(head.y, m2.y, 'item rows moved with the menu');
  assert.deepEqual(jam.player(1).sel, sel1);
  // a pick still works after the move
  const fire = m2.items.find((i) => i.id === 'fire');
  jam.setCursor(2, m2.x + 20, fire.y + 5);
  ev(jam, 'B 2 L 1', 10);
  ev(jam, 'B 2 L 0', 15);
  assert.equal(jam.player(2).menu, null, 'item click at the moved position was recognised');
  assert.ok(jam.player(1).menu, 'p1 menu untouched');
});

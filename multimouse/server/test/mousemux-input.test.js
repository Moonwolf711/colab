'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');
const { MouseMuxInput } = require('../mousemux-input');
const { createJam } = require('../jam-core');

const RECT = { x: -100, y: -200, w: 101, h: 201 };
const U = 0x100000000;
const H = 0x200000000;
const user = (id, hwid, name = 'User ' + id) => ({ id, name,
  devices: [{ hwid, type: 'pointer', subtype: 'mouse' }, { hwid: hwid + 1, type: 'keyboard' }] });
const roster = (users) => ({ type: 'user.list.notify.M2A', users });
const pointer = (kind, hwid, x = -50, y = -100, extra = {}) => ({ type: 'pointer.' + kind + '.notify.M2A', hwid, x, y, ...extra });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  const deadline = Date.now() + 2000;
  while (!fn()) { if (Date.now() >= deadline) assert.fail('Timed out waiting for fixture'); await sleep(5); }
}

function pure(t, options = {}) {
  const lines = [], actions = [];
  const jam = createJam({ viewport: { w: 800, h: 600 } });
  const input = new MouseMuxInput({ rect: RECT, ...options, onDatagram(text) {
    lines.push(...text.trim().split('\n'));
    actions.push(...jam.handleDatagram(text, Date.now()));
  } });
  t.after(() => input.stop());
  input._message({ type: 'client.login.request.A2M', ok: true });
  input._message(roster([user(7, 10), user(8, 20)]));
  return { input, lines, actions, jam };
}

async function fixture(t, handler, options = {}, serverOptions = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, ...serverOptions });
  await once(server, 'listening');
  const messages = [], peers = [], datagrams = [];
  server.on('connection', (ws) => {
    peers.push(ws);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()); messages.push(m);
      if (handler) handler(ws, m, peers.length);
    });
  });
  const input = new MouseMuxInput({ rect: RECT, url: 'ws://127.0.0.1:' + server.address().port,
    reconnectMs: 20, onDatagram: (s) => datagrams.push(s), ...options });
  t.after(async () => {
    input.stop();
    for (const peer of server.clients) peer.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  input.start();
  return { input, messages, peers, datagrams };
}

function accept(ws, m) {
  if (m.type === 'client.login.request.A2M') {
    ws.send(JSON.stringify({ type: 'server.info.notify.M2A', version: '3.0.19', systemId: 'DO-NOT-EXPOSE' }));
    ws.send(JSON.stringify({ type: m.type, ok: true }));
  } else if (m.type === 'user.list.request.A2M') ws.send(JSON.stringify(roster([user(7, 10)])));
}

test('rejects non-loopback URLs, credentials, missing regions and invalid options', () => {
  const options = { rect: RECT, onDatagram() {} };
  for (const url of ['ws://example.com', 'http://127.0.0.1:41001', 'ws://127.0.0.1@evil.test', 'ws://u:p@localhost', 'ws://localhost/?token=x']) {
    assert.throws(() => new MouseMuxInput({ ...options, url }));
  }
  for (const rect of [null, {}, { ...RECT, w: 0 }, { ...RECT, h: Infinity }, { ...RECT, x: 0.5 }]) {
    assert.throws(() => new MouseMuxInput({ ...options, rect }));
  }
  assert.throws(() => new MouseMuxInput({ ...options, reconnectMs: 0 }));
  for (const url of ['ws://localhost:41001', 'wss://127.0.0.1:41001', 'ws://[::1]:41001']) {
    assert.doesNotThrow(() => new MouseMuxInput({ ...options, url }));
  }
});

test('fixture receives flat login, user list and keepalive pong; starts disabled with sanitized status', async (t) => {
  const f = await fixture(t, accept);
  await until(() => f.input.getStatus().users.length === 1);
  assert.deepEqual(f.messages.slice(0, 2).map((m) => m.type), ['client.login.request.A2M', 'user.list.request.A2M']);
  assert.equal(f.messages[0].appName, 'CoLaB MultiMouse');
  assert.equal(f.messages[0].data, undefined);
  f.peers[0].send(JSON.stringify({ type: 'server.ping.notify.M2A' }));
  await until(() => f.messages.some((m) => m.type === 'client.pong.request.A2M'));
  assert.equal(f.input.getStatus().enabled, false);
  assert.equal(f.input.getStatus().version, '3.0.19');
  assert.ok(!JSON.stringify(f.input.getStatus()).includes('DO-NOT-EXPOSE'));
  f.peers[0].send(JSON.stringify(pointer('button', 10, 0, 0, { button: 3 })));
  await sleep(20);
  assert.ok(!f.datagrams.join('').includes('B '));
  f.input.setEnabled(true);
  f.peers[0].send(JSON.stringify(pointer('button', 10, 0, 0, { button: 3 })));
  await until(() => f.datagrams.join('').includes('B ' + (U + 7) + ' L 0'));
});

test('two authoritative users stay independent, signed origins map exactly, keyboard/native inputs ignored', (t) => {
  const { input, lines, jam } = pure(t);
  input.setEnabled(true); lines.length = 0;
  input._message(pointer('motion', 10, -100, -200));
  input._message(pointer('motion', 20, 0, 0));
  assert.ok(lines.includes('A ' + (U + 7) + ' 0 0'));
  assert.ok(lines.includes('A ' + (U + 8) + ' 65535 65535'));
  assert.deepEqual(jam.render(0).players.map((p) => p.idx), [U + 7, U + 8]);
  const count = lines.length;
  input._message(pointer('motion', 11));
  input._message(pointer('motion', 10, -50, -100, { inputSource: 'native' }));
  input._message({ type: 'keyboard.key.notify.M2A', hwid: 11, vkey: 65 });
  assert.equal(lines.length, count);
});

test('button coordinates precede transitions, combined flags work, duplicate down/up and wheel axes handled', (t) => {
  const { input, lines } = pure(t);
  input.setEnabled(true); lines.length = 0;
  input._message(pointer('button', 10, 0, 0, { button: 0x155 }));
  assert.equal(lines[1], 'A ' + (U + 7) + ' 65535 65535');
  assert.deepEqual(lines.slice(2), ['L', 'R', 'M', 'X1', 'X2'].map((b) => 'B ' + (U + 7) + ' ' + b + ' 1'));
  lines.length = 0;
  input._message(pointer('button', 10, 0, 0, { button: 0x155 }));
  assert.equal(lines.length, 1);
  input._message(pointer('button', 10, 0, 0, { button: 0x2aa }));
  assert.equal(lines.filter((line) => /^B .* 0$/.test(line)).length, 5);
  input._message(pointer('wheel', 10, 0, 0, { delta: -120 }));
  input._message(pointer('wheel', 10, 0, 0, { delta: 240, horizontal: true }));
  assert.ok(lines.includes('W ' + (U + 7) + ' -120'));
  assert.ok(lines.includes('H ' + (U + 7) + ' 240'));
});

test('leaving region, disabling, disposal and roster removal cancel held clicks without firing', (t) => {
  const { input, jam, lines, actions } = pure(t);
  jam.setSession({ ready: true, trackCount: 1, sceneCount: 1, tracks: [{ name: 'One' }],
    slots: [[{ has: true, name: 'clip' }]], scenes: [{ name: 'Scene' }] });
  const r = RECT;
  const x = r.x + (140 / 799) * (r.w - 1), y = r.y + (65 / 599) * (r.h - 1);
  const down = () => input._message(pointer('button', 10, x, y, { button: 1 }));
  input.setEnabled(true); down();
  input._message(pointer('motion', 10, r.x + r.w, y));
  assert.equal(jam.player(U + 7), null);
  input._message(pointer('button', 10, x, y, { button: 2 }));
  assert.equal(actions.length, 0);
  down(); input.setEnabled(false); assert.equal(jam.player(U + 7), null);
  input.setEnabled(true); down();
  input._message({ type: 'user.dispose.notify.M2A', hwid_ms: 10, hwid_kb: 11 });
  assert.equal(jam.player(U + 7), null);
  input._message(pointer('motion', 10, x, y));
  assert.equal(jam.player(H + 10), null, 'late disposed events must not resurrect a fallback player');
  input._message(roster([user(7, 10)])); down(); input._message(roster([]));
  assert.equal(jam.player(U + 7), null);
  assert.equal(actions.length, 0);
  assert.ok(lines.includes('D ' + (U + 7) + ' remove'));
});

test('unknown devices have stable collision-free fallback IDs; roster reconciles identity and names safely', (t) => {
  const { input, jam } = pure(t);
  input.setEnabled(true);
  input._message(pointer('motion', 99));
  assert.ok(jam.player(H + 99));
  input._message(roster([user(99, 99, 'name\nB 1 L 1')]));
  assert.equal(jam.player(H + 99), null);
  input._message(pointer('motion', 99));
  assert.ok(jam.player(U + 99));
  assert.ok(!input.getStatus().users[0].name.includes('\n'));
  input._message(roster([user(99, 99, 'renamed')]));
  assert.equal(jam.player(U + 99).name, 'MouseMux renamed');
  input._message(roster([user(0xffffffff, 99)]));
  input._message(pointer('motion', 99));
  assert.ok(jam.player(U + 0xffffffff));
});

test('ownership changes cancel held input until a fresh authoritative roster arrives', (t) => {
  const { input, jam } = pure(t);
  input.setEnabled(true);
  input._message(pointer('button', 10, 0, 0, { button: 1 }));
  input._message({ type: 'user.changed.notify.M2A', action: 'map', userId: 8, hwid_ms: 10, hwid_kb: 11 });
  assert.equal(jam.player(U + 7), null);
  input._message(pointer('motion', 10));
  assert.equal(jam.player(U + 7), null);
  input._message(roster([user(8, 10)]));
  input._message(pointer('motion', 10));
  assert.ok(jam.player(U + 8));
});

test('malformed packets cannot create actions or unbounded player state', (t) => {
  const { input, jam, lines } = pure(t);
  input.setEnabled(true); const count = lines.length;
  for (const m of [null, [], {}, { type: 3 }, pointer('motion', -1), pointer('motion', '10'),
    pointer('motion', 10, NaN, 0), pointer('button', 10, 0, 0, { button: 1024 }),
    pointer('wheel', 10, 0, 0, { delta: Infinity }), pointer('wheel', 10, 0, 0, { delta: 1, horizontal: 'yes' }),
    roster([{ id: 7, devices: 'bad' }])]) input._message(m);
  assert.equal(lines.length, count);
  for (let i = 1000; i < 1400; i++) input._message(pointer('motion', i));
  assert.equal(jam.render(0).players.length, 256);
});

test('create/changed refresh the authoritative list and disposal clears the user immediately', async (t) => {
  const f = await fixture(t, accept);
  await until(() => f.input.getStatus().users.length === 1);
  f.peers[0].send(JSON.stringify({ type: 'user.create.notify.M2A', hwid_ms: 20, hwid_kb: 21, name: 'New' }));
  f.peers[0].send(JSON.stringify({ type: 'user.changed.notify.M2A', action: 'map', userId: 7, hwid_ms: 10, hwid_kb: 11 }));
  await until(() => f.messages.filter((m) => m.type === 'user.list.request.A2M').length >= 3);
});

test('disconnect removes players and reconnects with a fresh login; stop leaves no reconnect timer', async (t) => {
  const f = await fixture(t, accept);
  await until(() => f.input.getStatus().users.length === 1);
  f.input.setEnabled(true);
  f.peers[0].send(JSON.stringify(pointer('button', 10, 0, 0, { button: 1 })));
  await until(() => f.datagrams.join('').includes('B ' + (U + 7)));
  f.peers[0].terminate();
  await until(() => f.peers.length === 2 && f.input.getStatus().connected);
  assert.ok(f.datagrams.join('').includes('D ' + (U + 7) + ' remove'));
  assert.equal(f.messages.filter((m) => m.type === 'client.login.request.A2M').length, 2);
  f.input.stop(); const count = f.peers.length; await sleep(60);
  assert.equal(f.peers.length, count); assert.equal(f.input.retry, null);
  assert.equal(f.input.getStatus().enabled, false);
});

test('reconnected input stays disabled and a roster alone cannot authorize input', async (t) => {
  const f = await fixture(t, (ws, m) => {
    if (m.type === 'user.list.request.A2M') ws.send(JSON.stringify(roster([user(7, 10)])));
  });
  await until(() => f.input.getStatus().users.length === 1);
  f.input.setEnabled(true);
  f.peers[0].send(JSON.stringify(pointer('button', 10, 0, 0, { button: 3 })));
  await sleep(20);
  assert.equal(f.input.getStatus().connected, false);
  assert.ok(!f.datagrams.join('').includes('B '));
  f.peers[0].send(JSON.stringify({ type: 'client.login.request.A2M', ok: true }));
  await until(() => f.input.getStatus().connected);
  f.peers[0].terminate();
  await until(() => f.peers.length === 2);
  f.peers[1].send(JSON.stringify({ type: 'client.login.request.A2M', ok: true }));
  await until(() => f.input.getStatus().connected);
  assert.equal(f.input.getStatus().enabled, false);
});

test('WebSocket ping detects a stalled server while ordinary idle clients remain connected', async (t) => {
  const live = await fixture(t, accept);
  await until(() => live.input.getStatus().connected);
  live.input._probe();
  await until(() => live.input.pongTimer === null);
  assert.equal(live.input.getStatus().connected, true);
  const stalled = await fixture(t, accept, {}, { autoPong: false });
  await until(() => stalled.input.getStatus().connected);
  stalled.input.setEnabled(true);
  const realTimeout = globalThis.setTimeout;
  let watchdog, watchdogTimer;
  const timeoutMock = t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    const timer = realTimeout(fn, ms, ...args);
    if (ms === 5000) { watchdog = () => fn(...args); watchdogTimer = timer; }
    return timer;
  });
  stalled.input._probe();
  timeoutMock.mock.restore();
  assert.equal(typeof watchdog, 'function');
  clearTimeout(watchdogTimer);
  watchdog();
  await until(() => !stalled.input.getStatus().connected);
  assert.equal(stalled.input.getStatus().enabled, false);
  assert.match(stalled.input.getStatus().error, /keepalive timed out/);
});

test('login rejection and server timeout are terminal, never retrying to bypass a stopped session', async (t) => {
  const reject = await fixture(t, (ws, m) => {
    if (m.type === 'client.login.request.A2M') ws.send(JSON.stringify({ type: m.type, ok: false, error: 'SDK disabled' }));
  });
  await until(() => reject.input.getStatus().error.includes('login rejected'));
  await sleep(60); assert.equal(reject.peers.length, 1);
  const f = await fixture(t, accept);
  await until(() => f.input.getStatus().connected);
  f.peers[0].send(JSON.stringify({ type: 'server.timeout.stopped.notify.M2A', reason: 'Trial session ended' }));
  await until(() => f.input.getStatus().error.includes('Trial session ended'));
  f.input.start(); f.input.setEnabled(true); await sleep(60);
  assert.equal(f.input.getStatus().enabled, false);
  assert.equal(f.peers.length, 1);
});

test('WebSocket malformed JSON and binary data are ignored; oversized messages disconnect safely', async (t) => {
  const f = await fixture(t, accept);
  await until(() => f.input.getStatus().connected);
  f.peers[0].send('{broken'); f.peers[0].send(Buffer.from(JSON.stringify(pointer('motion', 10))));
  await sleep(20);
  assert.ok(f.input.getStatus().connected);
  f.peers[0].send('x'.repeat(65537));
  await until(() => f.peers.length === 2);
  assert.ok(!f.datagrams.join('').includes('A '));
});

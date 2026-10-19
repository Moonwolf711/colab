'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

async function until(fn, label) {
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out: ' + label);
}

test('MouseMux reaches the panel and Ableton action pipeline with separate users', { timeout: 20000 }, async (t) => {
  const reserve = net.createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));

  const sdk = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
  await once(sdk, 'listening');
  let peer;
  const messages = [];
  sdk.on('connection', (ws) => {
    peer = ws;
    ws.send(JSON.stringify({ type: 'server.info.notify.M2A', version: '3.0.19', systemId: 'DO-NOT-EXPOSE' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)); messages.push(m);
      if (m.type === 'client.login.request.A2M') ws.send(JSON.stringify({ type: m.type, ok: true }));
      if (m.type === 'user.list.request.A2M') ws.send(JSON.stringify({ type: 'user.list.notify.M2A', users: [
        { id: 1, name: 'Alice', devices: [{ type: 'pointer', hwid: 101 }, { type: 'keyboard', hwid: 102 }] },
        { id: 2, name: 'Bob', devices: [{ type: 'pointer', hwid: 201 }] },
      ] }));
    });
  });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--no-ableton', '--port', String(port),
    '--mousemux', '--mousemux-url', 'ws://127.0.0.1:' + sdk.address().port, '--mousemux-rect', '-100,50,1280,720'],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  let panel;
  const base = 'http://127.0.0.1:' + port;
  t.after(async () => {
    if (panel) panel.terminate();
    try { await fetch(base + '/api/shutdown', { method: 'POST' }); } catch (_) { /* startup may have failed */ }
    for (const client of sdk.clients) client.terminate();
    await new Promise((resolve) => sdk.close(resolve));
    if (child.exitCode === null) {
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 700))]);
      if (child.exitCode === null) child.kill();
    }
  });
  const state = async () => {
    try { return await (await fetch(base + '/api/state')).json(); } catch (_) { return null; }
  };
  await until(async () => {
    assert.equal(child.exitCode, null, output);
    const s = await state();
    return s && s.status.mousemux.connected && s.status.mousemux.users.length === 2;
  }, 'SDK connection and roster');
  assert.equal((await state()).status.mousemux.enabled, false);
  panel = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  await once(panel, 'open');
  panel.send(JSON.stringify({ t: 'viewport', w: 1280, h: 720 }));
  panel.send(JSON.stringify({ t: 'jam', on: true }));
  await until(async () => (await state()).status.jam, 'input enabled');
  const send = (m) => peer.send(JSON.stringify(m));
  send({ type: 'pointer.motion.notify.M2A', hwid: 101, x: 40, y: 110 });
  send({ type: 'pointer.motion.notify.M2A', hwid: 201, x: 264, y: 110 });
  const two = await until(async () => { const s = await state(); return s.players.length === 2 && s; }, 'independent pointers');
  assert.notEqual(two.players[0].idx, two.players[1].idx);
  assert.equal(new Set(two.players.map((p) => p.name)).size, 2);
  assert.equal(two.players[0].x, 140);
  assert.equal(two.players[1].x, 364);

  // The fake set has clip 0:0. Clicking with no intervening motion still uses button coordinates.
  send({ type: 'pointer.button.notify.M2A', hwid: 101, x: 40, y: 110, button: 1 });
  send({ type: 'pointer.button.notify.M2A', hwid: 101, x: 40, y: 110, button: 2 });
  const commands = await until(async () => {
    const log = await (await fetch(base + '/api/log')).json();
    return log.commands.some((c) => c.cmd === 'fire_clip') && log.commands;
  }, 'clip launch action');
  assert.ok(commands.every((c) => c.outcome === 'fake'));

  panel.send(JSON.stringify({ t: 'input-pause' }));
  await until(async () => { const s = await state(); return !s.status.jam && s.players.length === 0; }, 'pause cleanup');
  send({ type: 'pointer.motion.notify.M2A', hwid: 201, x: 264, y: 110 });
  assert.equal((await state()).players.length, 0);
  panel.send(JSON.stringify({ t: 'jam', on: true }));
  await until(async () => (await state()).status.jam, 'resume');
  panel.send(JSON.stringify({ t: 'viewport', w: 1000, h: 600 }));
  await until(async () => !(await state()).status.jam, 'resize pauses input');
  assert.ok(messages.some((m) => m.type === 'client.login.request.A2M'));
  assert.ok(!JSON.stringify(await state()).includes('DO-NOT-EXPOSE'));
  assert.ok(!output.includes('DO-NOT-EXPOSE'));
});

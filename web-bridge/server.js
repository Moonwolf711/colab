/**
 * coLaB Web Bridge
 * - Receives partner diffs from colab_hub_v5.js via UDP :8001
 * - Polls local Ableton state via ableton-cli (AbletonOSC)
 * - Serves browser clients via HTTP :3030 + WebSocket :3030
 */

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const dgram   = require('dgram');
const { WebSocketServer } = require('ws');
const { exec } = require('child_process');

const HTTP_PORT     = 3030;
const UDP_PORT      = 8003; // separate from Max's :8001 — M4L outlet 1 forwards here
const CLI_DIR       = path.join(__dirname, '..', 'ableton-cli');
const LOCAL_POLL_MS = 3000;

// ─── Shared state ─────────────────────────────────────────────────────────────

const producers = {
  local: {
    label:     'You',
    userId:    'local',
    tracks:    [],
    transport: { playing: false, tempo: 120, position: 0 },
    cursor:    { track: -1 },
    online:    false,
    lastSeen:  0,
  },
  partner: {
    label:     'Partner',
    userId:    null,
    tracks:    [],
    transport: { playing: false, tempo: 120, position: 0 },
    cursor:    { track: -1 },
    online:    false,
    lastSeen:  0,
  },
};

// ─── WebSocket broadcast ───────────────────────────────────────────────────────

const clients = new Set();

function broadcast(msg) {
  const str = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(str);
  }
}

// ─── ableton-cli (optional — needs AbletonOSC running in Ableton) ─────────────

function runCli(args, cb) {
  // Try python -m cli_anything first, fall back to direct script call
  const attempts = [
    `python -m cli_anything ${args}`,
    `python cli_anything/__main__.py ${args}`,
  ];
  let i = 0;
  function next() {
    if (i >= attempts.length) return cb(null);
    exec(attempts[i++], { cwd: CLI_DIR, timeout: 3000 }, (err, stdout) => {
      if (err) return next();
      try { cb(JSON.parse(stdout.trim())); }
      catch { next(); }
    });
  }
  next();
}

function refreshLocalState() {
  runCli('--json track list', (data) => {
    if (!data) return;
    const list = Array.isArray(data) ? data : (data.tracks || []);
    producers.local.tracks = list.map((t, i) => ({
      index:  i,
      name:   t.name  || `Track ${i + 1}`,
      mute:   !!t.mute,
      solo:   !!t.solo,
      arm:    !!t.arm,
      volume: parseFloat(t.volume  ?? 0.85),
      pan:    parseFloat(t.pan     ?? 0),
      color:  t.color || 0,
    }));
    producers.local.online   = true;
    producers.local.lastSeen = Date.now();
    broadcast({ type: 'state', producers });
  });

  runCli('--json transport status', (data) => {
    if (!data) return;
    producers.local.transport = {
      playing:  !!(data.is_playing ?? data.playing),
      tempo:    parseFloat(data.tempo    || 120),
      position: parseFloat(data.position || data.current_song_time || 0),
    };
    producers.local.online   = true;
    producers.local.lastSeen = Date.now();
    broadcast({ type: 'state', producers });
  });
}

refreshLocalState();
const localPoll = setInterval(refreshLocalState, LOCAL_POLL_MS);

// ─── UDP — receive partner diffs ───────────────────────────────────────────────

const udp = dgram.createSocket('udp4');

udp.on('error', (err) => console.error(`[bridge] UDP error: ${err.message}`));

udp.on('message', (buf, rinfo) => {
  let data;
  try { data = JSON.parse(buf.toString()); } catch { return; }

  const { type, user, diffs, track } = data;
  if (!user) return;

  producers.partner.userId   = user;
  producers.partner.online   = true;
  producers.partner.lastSeen = Date.now();
  producers.partner.label    = `Partner · ${rinfo.address}`;

  if (type === 'sync' && Array.isArray(diffs)) {
    for (const d of diffs) {
      if (d.path === 'transport') {
        if (d.prop === 'playing') producers.partner.transport.playing = !!d.value;
        if (d.prop === 'tempo')   producers.partner.transport.tempo   = parseFloat(d.value);
      } else {
        const m = d.path.match(/^tracks\s+(\d+)$/);
        if (m) {
          const idx = parseInt(m[1]);
          // Grow tracks array as needed
          while (producers.partner.tracks.length <= idx) {
            const n = producers.partner.tracks.length;
            producers.partner.tracks.push({
              index: n, name: `Track ${n + 1}`,
              mute: false, solo: false, arm: false, volume: 0.85, pan: 0,
            });
          }
          producers.partner.tracks[idx][d.prop] =
            (d.prop === 'mute' || d.prop === 'solo' || d.prop === 'arm')
              ? !!d.value : d.value;
        }
      }
    }
    broadcast({ type: 'diff', source: 'partner', diffs });
  }

  if (type === 'cursor') {
    producers.partner.cursor.track = parseInt(track ?? -1);
    broadcast({ type: 'cursor', source: 'partner', track: producers.partner.cursor.track });
  }
});

udp.bind(UDP_PORT, '0.0.0.0', () => console.log(`[bridge] UDP :${UDP_PORT} ready (all diffs from M4L outlet 1)`));

// Partner offline timeout
setInterval(() => {
  if (producers.partner.online && Date.now() - producers.partner.lastSeen > 8000) {
    producers.partner.online = false;
    broadcast({ type: 'state', producers });
  }
}, 3000);

// ─── HTTP + WebSocket ──────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && /^\/(index\.html)?$/.test(req.url)) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, html) => {
      if (err) { res.writeHead(500); return res.end('Cannot read index.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  } else {
    res.writeHead(404); res.end();
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[bridge] Browser connected (${clients.size} open)`);
  ws.send(JSON.stringify({ type: 'state', producers }));
  ws.on('close', () => { clients.delete(ws); console.log(`[bridge] Browser disconnected (${clients.size} open)`); });
  ws.on('error', () => clients.delete(ws));
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  // Show the LAN IP so the partner knows where to point their browser
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const lanIPs = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) lanIPs.push(addr.address);
    }
  }
  console.log('\n[bridge] ╔══════════════════════════════╗');
  console.log('[bridge] ║   coLaB Web Bridge  v1.0      ║');
  console.log('[bridge] ╚══════════════════════════════╝');
  console.log(`[bridge]  Local  → http://localhost:${HTTP_PORT}`);
  lanIPs.forEach(ip => console.log(`[bridge]  LAN    → http://${ip}:${HTTP_PORT}   ← share this with partner`));
  console.log(`[bridge]  WS     → ws://0.0.0.0:${HTTP_PORT}`);
  console.log(`[bridge]  UDP    → :${UDP_PORT}  (M4L outlet 1 sends here)\n`);
  console.log('[bridge]  Max patch: add [udpsend 127.0.0.1 8003] to js outlet 1\n');
});

process.on('SIGINT', () => {
  clearInterval(localPoll);
  udp.close();
  server.close();
  process.exit(0);
});

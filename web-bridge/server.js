/**
 * coLaB Web Bridge
 * - Receives partner diffs from colab_hub_v5.js via UDP :8001
 * - Polls local Ableton state via ableton-cli (AbletonOSC)
 * - Serves browser clients via HTTP :3030 + WebSocket :3030
 */

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const dgram   = require('dgram');
const { WebSocketServer } = require('ws');
const { exec } = require('child_process');
const AssetResolver = require('../js/hub/asset-resolver');
const AlsDiffer = require('../js/hub/als-differ');
const AlsGit = require('../js/hub/als-git');
const CoLabEngine = require('../js/hub/colab-engine');

const HTTP_PORT     = 3030;
const UDP_PORT      = 8003; // separate from Max's :8001 — M4L outlet 1 forwards here
const CLI_DIR       = path.join(__dirname, '..', 'ableton-cli');
const SESSIONS_DIR  = path.join(__dirname, '..', 'data', 'sessions');
const LOCAL_POLL_MS = 3000;

// ─── Asset resolver ──────────────────────────────────────────────────────────
const assetResolver = new AssetResolver(null); // no liveBridge in Node context

// ─── ALS differ ──────────────────────────────────────────────────────────────
const alsDiffer = new AlsDiffer();
let lastAlsSnapshot = null;  // cached parsed tree of the last .als save
let alsWatcher = null;       // fs.watch handle for .als file

// ─── ALS git auto-commit ─────────────────────────────────────────────────────
const alsGit = new AlsGit({ autoPush: true, branch: 'main' });

alsGit.onCommit((hash, message, diff) => {
  const subject = message.split('\n')[0];
  console.log(`[bridge] Git commit: ${hash} — ${subject}`);
  broadcast({ type: 'git_commit', hash, subject, changeCount: diff ? diff.changes.length : 0, timestamp: Date.now() });
  sessionLog.push({ id: sessionLog.length, ts: Date.now(), type: 'git_commit', actor: 'system', data: { hash, subject } });
});

alsGit.onPush((hash) => {
  console.log(`[bridge] Git pushed: ${hash}`);
  broadcast({ type: 'git_push', hash, timestamp: Date.now() });
});

alsGit.onDiff((diffResult) => {
  // Also broadcast the diff to browser clients (reuse als_diff channel)
  broadcast({
    type: 'als_diff',
    changes: diffResult.changes,
    summary: diffResult.summary,
    text: alsDiffer.formatText(diffResult),
    timestamp: Date.now()
  });
});

alsGit.onError((err) => {
  console.error(`[bridge] Git error: ${err}`);
  broadcast({ type: 'git_error', error: err, timestamp: Date.now() });
});

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// ─── Session recap storage ────────────────────────────────────────────────────

let latestRecap = null;
const sessionLog = []; // in-memory activity log for current session
const MAX_SESSION_LOG = 5000;
const MAX_SESSION_FILES = 30;

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

  // Activity log entries from hub
  if (type === 'activity') {
    const entry = data.entry;
    if (entry) {
      sessionLog.push(entry);
      if (sessionLog.length > MAX_SESSION_LOG) sessionLog.shift();
    }
  }

  // Recap from hub on reconnect
  if (type === 'recap') {
    latestRecap = data.recap;
    broadcast({ type: 'recap', recap: latestRecap });
  }

  // Asset manifest from hub (project path + plugin list from LiveAPI)
  if (type === 'asset_manifest') {
    if (data.projectPath) assetResolver.setProjectPath(data.projectPath);
    broadcast({ type: 'asset_manifest', manifest: data.manifest });
  }

  // Missing file alert from hub
  if (type === 'asset_missing') {
    broadcast({ type: 'asset_missing', missing: data.missing, plugins: data.plugins });
  }

  // ─── BRIDGE: Forward M4L messages to peer via engine ─────────────────────
  if (engine && engine._connected) {
    // Forward cursor updates via UDP (fast path)
    if (type === 'cursor') {
      engine.sendCursor(
        parseInt(data.track ?? 0),
        parseInt(data.scene ?? 0),
        true,
        data.user || 'local'
      );
    }

    // Forward parameter diffs via UDP (fast path)
    if (type === 'sync' && Array.isArray(diffs)) {
      for (const d of diffs) {
        if (d.path === 'transport') {
          engine.sendTransport(
            d.prop === 'playing' ? !!d.value : undefined,
            d.prop === 'tempo' ? parseFloat(d.value) : undefined
          );
        } else {
          const m = d.path.match(/^tracks\s+(\d+)$/);
          if (m) {
            engine.sendParam(parseInt(m[1]), d.prop, d.value);
          }
        }
      }
    }
  }
});

udp.bind(UDP_PORT, '0.0.0.0', () => console.log(`[bridge] UDP :${UDP_PORT} ready (all diffs from M4L outlet 1)`));

// ─── BRIDGE: Forward peer engine data → local M4L device via UDP 8001 ────────

const M4L_PORT = 8001;
const m4lSender = dgram.createSocket('udp4');

function sendToM4L(msg) {
  const buf = Buffer.from(JSON.stringify(msg));
  m4lSender.send(buf, 0, buf.length, M4L_PORT, '127.0.0.1');
}

// Wire engine events from peer → M4L device
function wireEngineToM4L() {
  if (!engine) return;

  // Peer cursor → forward to local M4L in the exact format incoming() expects
  // M4L incoming() checks: data.type === "cursor" && data.track
  engine.on('cursor', (data) => {
    if (data && data.trackIdx !== undefined) {
      sendToM4L({
        type: 'cursor',
        user: 'partner',
        track: data.trackIdx,
        scene: data.sceneIdx || 0,
        ts: Date.now()
      });
      producers.partner.cursor.track = data.trackIdx;
      producers.partner.online = true;
      producers.partner.lastSeen = Date.now();
      broadcast({ type: 'cursor', source: 'partner', track: data.trackIdx, scene: data.sceneIdx });
    }
  });

  // Peer state (params/transport) → forward to local M4L
  // M4L incoming() checks: data.type === "sync" && data.diffs[]
  // Each diff: { path: "tracks 0" | "transport", prop: "volume"|"mute"|..., value: ... }
  engine.on('state', (data) => {
    if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) return;
    try {
      const payload = data.slice(5).toString('utf8');
      const msg = JSON.parse(payload);

      if (msg.type === 'param') {
        const diff = { path: 'tracks ' + msg.track, prop: msg.param, value: msg.value };
        sendToM4L({ type: 'sync', user: 'partner', diffs: [diff], ts: Date.now() });
        if (producers.partner.tracks[msg.track]) {
          producers.partner.tracks[msg.track][msg.param] = msg.value;
        }
        broadcast({ type: 'diff', source: 'partner', diffs: [diff] });
      }

      if (msg.type === 'transport') {
        const diffs = [
          msg.playing !== undefined ? { path: 'transport', prop: 'playing', value: msg.playing } : null,
          msg.tempo !== undefined ? { path: 'transport', prop: 'tempo', value: msg.tempo } : null
        ].filter(Boolean);
        sendToM4L({ type: 'sync', user: 'partner', diffs, ts: Date.now() });
        if (msg.playing !== undefined) producers.partner.transport.playing = msg.playing;
        if (msg.tempo !== undefined) producers.partner.transport.tempo = msg.tempo;
        broadcast({ type: 'diff', source: 'partner', diffs });
      }

      if (msg.type === 'als_save') {
        broadcast({ type: 'partner_als_save', data: msg });
      }

      if (msg.type === 'git_diff') {
        broadcast({ type: 'partner_git_commit', data: msg });
      }
    } catch(e) {
      // Not JSON — raw protocol packet, ignore
    }
  });

  // Peer als_diff (partner saved and we got the semantic diff)
  engine.on('partner_saved', (data) => {
    broadcast({ type: 'partner_saved', ...data, timestamp: Date.now() });
    console.log(`[bridge] Partner saved: ${data.changes ? data.changes.length : 0} changes`);
  });

  // Peer connected/disconnected
  engine.on('connect', (info) => {
    producers.partner.online = true;
    producers.partner.lastSeen = Date.now();
    producers.partner.label = `Partner · ${info.address || engine.peerIp}`;
    broadcast({ type: 'state', producers });
    // Tell M4L device the peer IP so it can set connected=true
    // This simulates what clicking "connect 192.168.0.83" does in the Max patcher
    sendToM4L({ type: 'engine_connect', partner: info.address || engine.peerIp });
    console.log(`[bridge] Peer connected via engine: ${info.address || engine.peerIp}`);
  });

  engine.on('disconnect', (reason) => {
    producers.partner.online = false;
    broadcast({ type: 'state', producers });
    sendToM4L({ type: 'engine_disconnect', reason });
    console.log(`[bridge] Peer disconnected: ${reason}`);
  });
}

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
  } else if (req.method === 'GET' && req.url === '/api/recap') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(latestRecap || { text: 'No recap available.', sections: [], summary: null }));
  } else if (req.method === 'GET' && req.url === '/api/session-log') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ entries: sessionLog, count: sessionLog.length }));
  } else if (req.method === 'GET' && req.url === '/api/sessions') {
    // List saved session files
    try {
      const files = fs.readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 20);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ sessions: files }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions: [] }));
    }
  } else if (req.method === 'GET' && req.url === '/cursor-test') {
    fs.readFile(path.join(__dirname, 'cursor-test.html'), (err, html) => {
      if (err) { res.writeHead(500); return res.end('Cannot read cursor-test.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

  // ─── Asset Management Endpoints ──────────────────────────────────────────
  } else if (req.method === 'POST' && req.url === '/api/assets/set-project') {
    // Set the project path for asset scanning
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { projectPath } = JSON.parse(body);
        assetResolver.setProjectPath(projectPath);
        const verify = assetResolver.verifyCollected();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, projectPath, collected: verify }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'GET' && req.url === '/api/assets/manifest') {
    // Build and return the local asset manifest
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    const manifest = assetResolver.buildManifest();
    if (!manifest) {
      res.end(JSON.stringify({ error: 'no_project_path', hint: 'POST /api/assets/set-project first' }));
    } else {
      res.end(JSON.stringify(manifest));
    }

  } else if (req.method === 'GET' && req.url === '/api/assets/verify-collected') {
    // Check if Collect All and Save has been run
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(assetResolver.verifyCollected()));

  } else if (req.method === 'POST' && req.url === '/api/assets/resolve') {
    // Compare against a remote manifest to find missing files
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const remoteManifest = JSON.parse(body);
        const result = assetResolver.resolveAgainst(remoteManifest);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'POST' && req.url === '/api/assets/transfer') {
    // Request a file from this peer's project (for partner to download)
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { path: filePath } = JSON.parse(body);
        const file = assetResolver.getFileForTransfer(filePath);
        if (!file) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'file_not_found', path: filePath }));
        } else if (file.error) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(file));
        } else {
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': file.size,
            'X-File-Path': file.path,
            'Access-Control-Allow-Origin': '*'
          });
          res.end(file.data);
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'POST' && req.url === '/api/assets/receive') {
    // Receive a file from partner and write to local project
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const filePath = req.headers['x-file-path'];
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'missing X-File-Path header' }));
      }
      const data = Buffer.concat(chunks);
      const result = assetResolver.receiveFile(filePath, data);
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    });

  } else if (req.method === 'GET' && req.url === '/api/assets/summary') {
    // Quick status: collected? missing count? transfer ready?
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(assetResolver.getSummary()));

  // ─── ALS Diff Endpoints ──────────────────────────────────────────────────
  } else if (req.method === 'POST' && req.url === '/api/als/diff') {
    // Diff two .als files. Body: { pathA: "...", pathB: "..." } or raw buffers
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { pathA, pathB } = JSON.parse(body);
        if (!pathA || !pathB) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'pathA and pathB required' }));
        }
        alsDiffer.diff(pathA, pathB, (err, result) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(result));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'POST' && req.url === '/api/als/diff-text') {
    // Same as /diff but returns human-readable text
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { pathA, pathB } = JSON.parse(body);
        alsDiffer.diff(pathA, pathB, (err, result) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end('Error: ' + err.message);
          }
          res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end(alsDiffer.formatText(result));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Error: ' + e.message);
      }
    });

  } else if (req.method === 'POST' && req.url === '/api/als/watch') {
    // Start watching an .als file for saves. On each save, auto-diff against previous snapshot.
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { alsPath } = JSON.parse(body);
        if (!alsPath || !fs.existsSync(alsPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'alsPath not found' }));
        }

        // Stop existing watcher
        if (alsWatcher) { alsWatcher.close(); alsWatcher = null; }

        // Take initial snapshot
        lastAlsSnapshot = alsDiffer.parseSync(fs.readFileSync(alsPath));
        console.log('[bridge] ALS watcher: initial snapshot of ' + path.basename(alsPath));

        // Watch for changes (Ableton saves = rename + write)
        let debounce = null;
        alsWatcher = fs.watch(path.dirname(alsPath), (eventType, filename) => {
          if (filename !== path.basename(alsPath)) return;
          if (debounce) clearTimeout(debounce);

          debounce = setTimeout(() => {
            try {
              const newTree = alsDiffer.parseSync(fs.readFileSync(alsPath));
              if (lastAlsSnapshot) {
                const diffResult = alsDiffer._diffTrees(lastAlsSnapshot, newTree);
                if (diffResult.changes.length > 0) {
                  console.log('[bridge] ALS diff: ' + diffResult.changes.length + ' changes detected');
                  broadcast({
                    type: 'als_diff',
                    changes: diffResult.changes,
                    summary: diffResult.summary,
                    text: alsDiffer.formatText(diffResult),
                    timestamp: Date.now()
                  });

                  // Log to session
                  sessionLog.push({
                    id: sessionLog.length,
                    ts: Date.now(),
                    type: 'als_save',
                    actor: 'local',
                    data: {
                      changeCount: diffResult.changes.length,
                      summary: diffResult.summary
                    }
                  });
                }
              }
              lastAlsSnapshot = newTree;
            } catch (e) {
              console.error('[bridge] ALS diff error:', e.message);
            }
          }, 1000); // 1s debounce — Ableton writes aren't atomic
        });

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, watching: alsPath }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'POST' && req.url === '/api/als/unwatch') {
    // Stop watching
    if (alsWatcher) { alsWatcher.close(); alsWatcher = null; }
    lastAlsSnapshot = null;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));

  } else if (req.method === 'GET' && req.url === '/api/als/snapshot') {
    // Get summary of current snapshot (for debugging)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    if (!lastAlsSnapshot) {
      res.end(JSON.stringify({ snapshot: null, hint: 'POST /api/als/watch to start' }));
    } else {
      res.end(JSON.stringify({
        snapshot: true,
        meta: lastAlsSnapshot.meta,
        timestamp: Date.now()
      }));
    }

  // ─── Git Auto-Commit Endpoints ───────────────────────────────────────────
  } else if (req.method === 'POST' && req.url === '/api/git/watch') {
    // Start watching an .als file with git auto-commit on save
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { alsPath, remote, branch, autoPush } = JSON.parse(body);
        if (!alsPath || !fs.existsSync(alsPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'alsPath not found' }));
        }

        // Configure
        if (remote) alsGit._remoteName = remote;
        if (branch) alsGit._branchName = branch;
        if (autoPush !== undefined) alsGit._autoPush = autoPush;

        // Setup project git config
        alsGit.ensureGitignore();
        alsGit.ensureGitattributes();

        // Start watching
        const ok = alsGit.watch(alsPath);
        if (!ok) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Failed to start watcher' }));
        }

        console.log(`[bridge] Git auto-commit watching: ${alsPath}`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          ok: true,
          watching: alsPath,
          remote: alsGit._remoteName,
          branch: alsGit._branchName,
          autoPush: alsGit._autoPush
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'POST' && req.url === '/api/git/unwatch') {
    alsGit.unwatch();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));

  } else if (req.method === 'POST' && req.url === '/api/git/commit') {
    // Manual commit
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { message } = JSON.parse(body);
        alsGit.commitNow(message);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, queued: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'GET' && req.url === '/api/git/log') {
    // Get recent commit history
    alsGit.getLog(30, (err, entries) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      if (err) {
        res.end(JSON.stringify({ error: err, entries: [] }));
      } else {
        res.end(JSON.stringify({ entries }));
      }
    });

  } else if (req.method === 'POST' && req.url === '/api/git/diff-commits') {
    // Semantic diff between two git commits
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { hashA, hashB } = JSON.parse(body);
        alsGit.diffCommits(hashA, hashB, (err, result) => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          if (err) {
            res.end(JSON.stringify({ error: err }));
          } else {
            res.end(JSON.stringify(result));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
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
  // Send latest recap if available
  if (latestRecap) {
    ws.send(JSON.stringify({ type: 'recap', recap: latestRecap }));
  }
  ws.on('close', () => { clients.delete(ws); console.log(`[bridge] Browser disconnected (${clients.size} open)`); });
  ws.on('error', () => clients.delete(ws));
});

// ─── coLaB Engine (unified transport + sync) ──────────────────────────────────

const PEER_IP = process.env.COLAB_PEER || null;
const PROJECT_PATH = process.env.COLAB_PROJECT || null;
const ALS_FILE = process.env.COLAB_ALS || null;

let engine = null;

const engineEvents = [
  'connect', 'disconnect', 'cursor', 'state', 'rtt', 'bandwidth',
  'als_diff', 'partner_saved', 'conflict', 'conflict_diff',
  'git_commit', 'git_push', 'git_error',
  'asset_missing', 'peer_manifest', 'file_received', 'file_changed',
  'backpressure', 'timeout', 'reconnecting', 'buffer_adjusted',
  'sync_started', 'sync_param', 'sync_cursor', 'sync_conflict',
  'sync_config', 'sync_change',
  'error'
];

if (PROJECT_PATH || PEER_IP) {
  engine = new CoLabEngine({
    projectPath: PROJECT_PATH,
    alsFile: ALS_FILE,
    peerIp: PEER_IP,
    role: PEER_IP ? 'client' : 'server',
    udpBufferMs: 20,
    tcpBufferBytes: 256 * 1024,
    networkQuality: 'fast',
    autoPush: true,
    gitBranch: 'main',
    oneDriveSync: true,
    conflictAlert: true
  });

  // Forward engine events to browser clients via WebSocket
  // NOTE: engineEvents defined at module scope so /api/engine/start can use it too
  engineEvents.forEach(evt => {
    engine.on(evt, (data) => {
      broadcast({ type: 'engine_' + evt, data, timestamp: Date.now() });
      if (evt === 'connect') console.log(`[engine] Peer connected: ${JSON.stringify(data)}`);
      if (evt === 'disconnect') console.log(`[engine] Peer disconnected: ${data}`);
      if (evt === 'als_diff') console.log(`[engine] ALS diff: ${data.changes ? data.changes.length : 0} changes`);
      if (evt === 'partner_saved') console.log(`[engine] Partner saved: ${data.changes ? data.changes.length : 0} changes`);
      if (evt === 'conflict') console.log(`[engine] CONFLICT: ${data.filename}`);
      if (evt === 'git_commit') console.log(`[engine] Git: ${data.hash} — ${data.message ? data.message.split('\n')[0] : ''}`);
      if (evt === 'error') console.log(`[engine] Error: ${JSON.stringify(data)}`);
    });
  });

  wireEngineToM4L();

  engine.start((err) => {
    if (err) console.error(`[engine] Start error: ${err}`);
    else console.log(`[engine] Started — UDP :${engine._udpPort} TCP :${engine._tcpPort} OneDrive:${engine._oneDriveEnabled}`);
  });
}

// ─── Engine API endpoints ──────────────────────────────────────────────────────

// Dynamically add engine endpoints to the HTTP server
const origListeners = server.listeners('request');
server.removeAllListeners('request');
server.on('request', (req, res) => {
  // Engine-specific endpoints
  if (req.method === 'GET' && req.url === '/api/engine/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(engine ? engine.getStats() : { error: 'engine not initialized' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/engine/start') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const opts = JSON.parse(body);
        if (engine) engine.stop();
        engine = new CoLabEngine(opts);
        engineEvents.forEach(evt => {
          engine.on(evt, (data) => broadcast({ type: 'engine_' + evt, data, timestamp: Date.now() }));
        });
        wireEngineToM4L();
        engine.start((err) => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: !err, error: err ? err.message : null, stats: engine.getStats() }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/engine/connect') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { peerIp } = JSON.parse(body);
        if (!engine) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'engine not started' }));
        }
        engine.connectToPeer(peerIp, (err) => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: !err, error: err ? err.message : null }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/engine/stop') {
    if (engine) engine.stop();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/engine/ping') {
    if (engine) engine.ping();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ─── Sync Controller endpoints ──────────────────────────────────────────

  if (req.method === 'GET' && req.url === '/api/sync/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(engine && engine.sync ? engine.sync.getFullState() : { error: 'sync not initialized' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/sync/config') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        if (!engine || !engine.sync) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'sync not initialized' }));
        }
        const config = JSON.parse(body);
        const result = engine.sync.setConfig(config);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, config: result }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Inject a sync delta directly into the engine (for full-sync-push script)
  if (req.method === 'POST' && req.url === '/api/sync/send-delta') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        if (!engine) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'engine not started' }));
        }
        const payload = JSON.parse(body);
        const deltaType = payload.type;
        if (deltaType === 'param') {
          engine.sendParam(payload.track, payload.param, payload.value);
        } else {
          engine.sendSyncDelta(deltaType, payload);
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && /^\/api\/sync\/track\/(\d+)$/.test(req.url)) {
    const trackIndex = parseInt(req.url.match(/\/api\/sync\/track\/(\d+)/)[1]);
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        if (!engine || !engine.sync) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'sync not initialized' }));
        }
        const overrides = JSON.parse(body);
        engine.sync.setTrackOverride(trackIndex, overrides);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, trackIndex, overrides }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/sync/audio-toggle') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        if (!engine || !engine.sync) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'sync not initialized' }));
        }
        const { enabled } = JSON.parse(body);
        engine.sync.setAudioMonitor(enabled);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, audioMonitor: enabled }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/dashboard') {
    fs.readFile(path.join(__dirname, 'dashboard.html'), (err, html) => {
      if (err) { res.writeHead(500); return res.end('Cannot read dashboard.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  // Pass to original handler
  origListeners.forEach(fn => fn.call(server, req, res));
});

// ─── HTTP server start ────────────────────────────────────────────────────────

server.listen(HTTP_PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const lanIPs = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) lanIPs.push(addr.address);
    }
  }
  console.log('\n[bridge] ╔══════════════════════════════════════╗');
  console.log('[bridge] ║   coLaB Web Bridge  v2.0 + Engine     ║');
  console.log('[bridge] ╚══════════════════════════════════════╝');
  console.log(`[bridge]  Local  → http://localhost:${HTTP_PORT}`);
  lanIPs.forEach(ip => console.log(`[bridge]  LAN    → http://${ip}:${HTTP_PORT}`));
  console.log(`[bridge]  WS     → ws://0.0.0.0:${HTTP_PORT}`);
  console.log(`[bridge]  UDP    → :${UDP_PORT}  (M4L outlet 1)`);
  if (engine) {
    console.log(`[bridge]  Engine → UDP :${engine._udpPort} + TCP :${engine._tcpPort}`);
    console.log(`[bridge]  Peer   → ${engine.peerIp || 'waiting for /api/engine/connect'}`);
    if (engine.projectPath) console.log(`[bridge]  Project→ ${engine.projectPath}`);
  } else {
    console.log(`[bridge]  Engine → not started (set COLAB_PEER/COLAB_PROJECT env vars, or POST /api/engine/start)`);
  }
  console.log('');
});

process.on('SIGINT', () => {
  clearInterval(localPoll);
  if (engine) engine.stop();
  udp.close();
  server.close();
  process.exit(0);
});

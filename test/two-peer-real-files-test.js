/**
 * two-peer-real-files-test.js — local-loopback integration test that
 * uses COPIES of the user's actual `test 1.als` and `test 2.als`
 * Ableton project files. Verifies the full Phase 1 + Phase 2 stack
 * end-to-end without needing a running AbletonBridge or two real
 * Ableton instances connected via the bridge.
 *
 * What this test exercises (REAL code paths, not mocks):
 *   - colab-engine instantiation with syncEnabled:false (skips bridge)
 *   - tcp-stack peer connection on a non-default port
 *   - als-git fs.watch + 2-second debounce against the real .als file
 *   - als-git → onRawSave → AlsReplicator.sendSet
 *   - tcp.sendMessage(PKT.ALS_SET) frame round-trip
 *   - AlsReplicator._onRemote sha verify + atomic write
 *   - colab-engine 'als_replicated' event forwarding
 *   - M4LNotifier dgram packet to a configurable UDP port
 *   - Both directions: peer A → peer B AND peer B → peer A
 *
 * What this test does NOT cover (requires AbletonBridge enabled in
 * both Live preferences with the env-var port patch):
 *   - param-sync.js poll + apply against real Ableton state
 *   - Warp markers, automation, extended notes round-trip on real clips
 *   - The notification ack via M4L colab_livesync.js applyDelta
 *
 * Originals are NEVER modified — we copy them into temp project dirs
 * and run the test on the copies.
 *
 * Run: node test/two-peer-real-files-test.js
 * Exit: 0 on success, 1 on any failure.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var dgram = require('dgram');

var CoLabEngine = require('../js/hub/colab-engine');

// ---------------------------------------------------------------------------
// Tiny harness
// ---------------------------------------------------------------------------

var pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); pass++; }
  else    { console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); fail++; }
}
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function sha256File(p) {
  var h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// Project paths — the user's real files (read-only — never written)
// ---------------------------------------------------------------------------

var SRC_PROJECT_A = 'C:\\Users\\Owner\\OneDrive\\Desktop\\test 1 Project';
var SRC_PROJECT_B = 'C:\\Users\\Owner\\OneDrive\\Desktop\\test 2 Project';
var SRC_ALS_A = path.join(SRC_PROJECT_A, 'test 1.als');
var SRC_ALS_B = path.join(SRC_PROJECT_B, 'test 2.als');

// ---------------------------------------------------------------------------
// Test setup: copy the real .als files into temp working dirs
// ---------------------------------------------------------------------------

function setupWorkspace() {
  var workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-twopeer-'));
  var dirA = path.join(workRoot, 'A');
  var dirB = path.join(workRoot, 'B');
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);

  if (!fs.existsSync(SRC_ALS_A)) {
    throw new Error('source .als A missing: ' + SRC_ALS_A);
  }
  if (!fs.existsSync(SRC_ALS_B)) {
    throw new Error('source .als B missing: ' + SRC_ALS_B);
  }

  var alsA = path.join(dirA, 'test 1.als');
  var alsB = path.join(dirB, 'test 2.als');
  fs.copyFileSync(SRC_ALS_A, alsA);
  fs.copyFileSync(SRC_ALS_B, alsB);

  return { workRoot: workRoot, dirA: dirA, dirB: dirB, alsA: alsA, alsB: alsB };
}

function teardownWorkspace(ws) {
  try { fs.rmSync(ws.workRoot, { recursive: true, force: true }); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Two engines on different ports
// ---------------------------------------------------------------------------

function buildEngines(ws, portBase) {
  // Engine A: server, no peerIp until B connects
  var engA = new CoLabEngine({
    projectPath: ws.dirA,
    alsFile: 'test 1.als',
    role: 'server',
    tcpPort: portBase,
    udpPort: portBase + 10,
    udpDataPort: portBase + 20,
    m4lPort: portBase + 100,
    uid: 'engineA',
    syncEnabled: false,        // skip AbletonBridge — not enabled
    oneDriveSync: false,       // skip OneDrive watcher — irrelevant here
    autoPush: false,           // skip git push to nonexistent remote
    gitRemote: 'none',
    abletonHost: '127.0.0.1',  // not used since syncEnabled is false
  });

  // Engine B: client, will connect to engine A
  var engB = new CoLabEngine({
    projectPath: ws.dirB,
    alsFile: 'test 2.als',
    role: 'client',
    peerIp: '127.0.0.1',
    tcpPort: portBase,         // matches A's listen port
    udpPort: portBase + 11,
    udpDataPort: portBase + 21,
    m4lPort: portBase + 101,
    uid: 'engineB',
    syncEnabled: false,
    oneDriveSync: false,
    autoPush: false,
    gitRemote: 'none',
  });

  return { engA: engA, engB: engB };
}

function startEngine(eng) {
  return new Promise(function(resolve, reject) {
    eng.start(function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Wait for both engines to mark themselves connected
// ---------------------------------------------------------------------------

function waitConnected(engA, engB, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var aConn = false, bConn = false;

    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error('connect timeout (engineA=' + aConn + ' engineB=' + bConn + ')'));
    }, timeoutMs || 8000);

    function check() {
      if (done) return;
      if (aConn && bConn) {
        done = true;
        clearTimeout(timer);
        resolve();
      }
    }

    engA.on('connect', function() { aConn = true; check(); });
    engB.on('connect', function() { bConn = true; check(); });

    // Engines already started by caller — they'll fire 'connect' once
    // tcp-stack reports it. If they're already connected we won't get
    // the event, so check the underlying state too:
    setTimeout(function() {
      if (engA._connected) { aConn = true; }
      if (engB._connected) { bConn = true; }
      check();
    }, 100);
  });
}

// ---------------------------------------------------------------------------
// Bind a UDP receiver to capture M4LNotifier packets
// ---------------------------------------------------------------------------

function bindNotifierReceiver(port) {
  return new Promise(function(resolve, reject) {
    var sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    var received = [];
    sock.on('message', function(msg) {
      try {
        received.push(JSON.parse(msg.toString('utf8')));
      } catch (e) {
        received.push({ raw: msg.toString('utf8'), parseError: e.message });
      }
    });
    sock.on('error', function(err) { reject(err); });
    sock.bind(port, '127.0.0.1', function() { resolve({ sock: sock, received: received }); });
  });
}

// ---------------------------------------------------------------------------
// Test 1: bidirectional file replication using real Ableton .als files
// ---------------------------------------------------------------------------

async function testBidirectionalRealFiles() {
  console.log('\n══ Test: bidirectional .als replication on REAL Ableton project files ══');

  var ws = setupWorkspace();
  console.log('  workspace: ' + ws.workRoot);
  console.log('  alsA: ' + ws.alsA + ' (' + fs.statSync(ws.alsA).size + ' bytes)');
  console.log('  alsB: ' + ws.alsB + ' (' + fs.statSync(ws.alsB).size + ' bytes)');

  var initialShaA = sha256File(ws.alsA);
  var initialShaB = sha256File(ws.alsB);
  t('initial alsA != alsB (different files to start)', initialShaA !== initialShaB);

  // Pick a high port base unlikely to collide.
  var portBase = 14260;
  var engines = buildEngines(ws, portBase);
  var engA = engines.engA, engB = engines.engB;

  // Bind notifier receivers BEFORE starting engines so we don't miss
  // the initial sent/received notifications.
  var rxA = await bindNotifierReceiver(portBase + 100);
  var rxB = await bindNotifierReceiver(portBase + 101);

  // Track engine-level events
  var aOut = [], aIn = [], bOut = [], bIn = [];
  engA.on('als_replicated', function(d) {
    if (d.direction === 'out') aOut.push(d);
    else aIn.push(d);
  });
  engB.on('als_replicated', function(d) {
    if (d.direction === 'out') bOut.push(d);
    else bIn.push(d);
  });

  try {
    // Start both engines.
    await startEngine(engA);
    await startEngine(engB);
    console.log('  both engines started');

    // Wait for tcp peer link.
    await waitConnected(engA, engB, 10000);
    console.log('  tcp peer link UP');

    t('engineA tcp connected', engA._connected === true);
    t('engineB tcp connected', engB._connected === true);

    // ── Direction A → B ──
    // Modify alsA so its bytes differ from alsB. We append a few null
    // bytes to the end (still gzipped XML — Ableton would reject this
    // but als-replicator doesn't care; the differ might log a warning
    // but the raw-save hook fires before parse).
    var mutantBytes = Buffer.concat([
      fs.readFileSync(ws.alsA),
      Buffer.from('\n<!-- colab test marker A->B -->', 'utf8')
    ]);
    var expectedShaAB = crypto.createHash('sha256').update(mutantBytes).digest('hex');
    fs.writeFileSync(ws.alsA, mutantBytes);
    console.log('  wrote mutated alsA (' + mutantBytes.length + ' bytes, sha=' + expectedShaAB.slice(0, 12) + ')');

    // als-git debounce is 2 s; tcp transit ~ms; remote write ~ms.
    await sleep(3500);

    var newShaB = sha256File(ws.alsB);
    t('alsB now matches mutated alsA',
      newShaB === expectedShaAB,
      'expected ' + expectedShaAB.slice(0, 12) + ' got ' + newShaB.slice(0, 12));
    t('engineA emitted als_replicated direction=out', aOut.length >= 1,
      'count=' + aOut.length);
    t('engineB emitted als_replicated direction=in', bIn.length >= 1,
      'count=' + bIn.length);

    // ── Direction B → A ──
    var mutantBytes2 = Buffer.concat([
      fs.readFileSync(ws.alsB),
      Buffer.from('\n<!-- colab test marker B->A -->', 'utf8')
    ]);
    var expectedShaBA = crypto.createHash('sha256').update(mutantBytes2).digest('hex');
    fs.writeFileSync(ws.alsB, mutantBytes2);
    console.log('  wrote mutated alsB (' + mutantBytes2.length + ' bytes, sha=' + expectedShaBA.slice(0, 12) + ')');

    await sleep(3500);

    var newShaA = sha256File(ws.alsA);
    t('alsA now matches mutated alsB',
      newShaA === expectedShaBA,
      'expected ' + expectedShaBA.slice(0, 12) + ' got ' + newShaA.slice(0, 12));
    t('engineB emitted als_replicated direction=out', bOut.length >= 1,
      'count=' + bOut.length);
    t('engineA emitted als_replicated direction=in', aIn.length >= 1,
      'count=' + aIn.length);

    // ── Notifier UDP packets ──
    // Each side should have fired info() on its own m4l port:
    //   - the local "shipped <name> to peer" line on its OWN port
    //   - the remote "peer saved <name>" line on its OWN port
    //
    // We bound rxA on engineA's m4l port (portBase+100) and rxB on engineB's
    // (portBase+101). Each rx should have at least 2 packets after both
    // round-trips (one out + one in per side).
    console.log('  rxA notifier packets: ' + rxA.received.length);
    console.log('  rxB notifier packets: ' + rxB.received.length);

    t('rxA received >= 2 notifier packets', rxA.received.length >= 2,
      'got ' + rxA.received.length);
    t('rxB received >= 2 notifier packets', rxB.received.length >= 2,
      'got ' + rxB.received.length);

    // Inspect format
    if (rxA.received.length > 0) {
      var sample = rxA.received[0];
      t('rxA first packet has t==="nf"', sample && sample.t === 'nf');
      t('rxA first packet has tag', sample && (sample.tag === '[INFO]' || sample.tag === '[WARN]' || sample.tag === '[ERR]'));
      t('rxA first packet has u==="colab-engine-' + process.pid.toString().slice(0, 0) || sample && typeof sample.u === 'string',
        sample && typeof sample.u === 'string');
      console.log('  sample: ' + JSON.stringify(sample));
    }

    // ── Replicator stats sanity ──
    t('engineA.alsReplicator.stats.sent >= 1', engA.alsReplicator.stats.sent >= 1,
      'sent=' + engA.alsReplicator.stats.sent);
    t('engineA.alsReplicator.stats.received >= 1', engA.alsReplicator.stats.received >= 1,
      'received=' + engA.alsReplicator.stats.received);
    t('engineB.alsReplicator.stats.sent >= 1', engB.alsReplicator.stats.sent >= 1,
      'sent=' + engB.alsReplicator.stats.sent);
    t('engineB.alsReplicator.stats.received >= 1', engB.alsReplicator.stats.received >= 1,
      'received=' + engB.alsReplicator.stats.received);

  } finally {
    rxA.sock.close();
    rxB.sock.close();
    try { engA.stop(); } catch (e) {}
    try { engB.stop(); } catch (e) {}
    teardownWorkspace(ws);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== Two-Peer Real-Files Integration Test ===');

  try {
    await testBidirectionalRealFiles();
  } catch (e) {
    console.log('\n!! HARNESS ERROR: ' + e.message);
    console.log(e.stack);
    fail++;
  }

  // Give async operations a moment to settle so the process can exit cleanly.
  setTimeout(function() {
    console.log('\n=== ' + pass + ' pass, ' + fail + ' fail ===');
    process.exit(fail === 0 ? 0 : 1);
  }, 500);
}

run();

/**
 * als-replicator-test.js — unit test for the LAN .als file replicator
 *
 * Spins up two in-process TcpStack instances on localhost, attaches an
 * AlsReplicator to each, simulates a save on peer A, and verifies that:
 *   1. Peer B receives an 'als_set' event and writes the file atomically
 *   2. sha256 round-trips identically
 *   3. Echo guard: sending the same sha twice in the window drops the
 *      second arrival (simulated by calling _onRemote manually with a
 *      freshly-recorded sha)
 *   4. Grace window: a remote that arrives right after a local send is
 *      dropped as LWW
 *   5. Oversize drop: a buffer larger than `maxBytes` is refused
 *
 * No AbletonBridge / no Ableton required — pure in-process LAN loopback.
 *
 * Run: node test/als-replicator-test.js
 * Exit code: 0 on success, 1 on any failure.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');

var TcpStack = require('../js/hub/tcp-stack');
var AlsReplicator = require('../js/hub/als-replicator');

// ---------------------------------------------------------------------------
// Tiny harness
// ---------------------------------------------------------------------------

var pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); pass++; }
  else    { console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); fail++; }
}
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function randomPort() { return 40000 + Math.floor(Math.random() * 20000); }

// ---------------------------------------------------------------------------
// Harness: spin up two TcpStack instances and two AlsReplicators
// ---------------------------------------------------------------------------

function buildPair(port, options) {
  options = options || {};
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'als-rep-'));
  var pathA = path.join(tmp, 'peerA.als');
  var pathB = path.join(tmp, 'peerB.als');
  // Seed peerB with an empty file so setAlsPath has something to replace.
  fs.writeFileSync(pathB, Buffer.alloc(0));

  var server = new TcpStack({ port: port, reconnect: false });
  var client = new TcpStack({ port: port, reconnect: false });

  var repA = new AlsReplicator({
    tcp: server, alsPath: pathA,
    echoWindowMs: options.echoWindowMs,
    localSaveGraceMs: options.localSaveGraceMs,
    maxBytes: options.maxBytes
  });
  var repB = new AlsReplicator({
    tcp: client, alsPath: pathB,
    echoWindowMs: options.echoWindowMs,
    localSaveGraceMs: options.localSaveGraceMs,
    maxBytes: options.maxBytes
  });

  return {
    tmp: tmp,
    pathA: pathA, pathB: pathB,
    server: server, client: client,
    repA: repA, repB: repB
  };
}

function destroyPair(p) {
  try { p.server.destroy(); } catch (e) {}
  try { p.client.destroy(); } catch (e) {}
  try {
    if (fs.existsSync(p.pathA)) fs.unlinkSync(p.pathA);
    if (fs.existsSync(p.pathB)) fs.unlinkSync(p.pathB);
    fs.rmdirSync(p.tmp);
  } catch (e) {}
}

function waitConnected(pair, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var serverConnected = false;
    var clientConnected = false;

    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error('connect timeout (server=' + serverConnected +
                       ', client=' + clientConnected + ')'));
    }, timeoutMs || 5000);

    function maybeResolve() {
      if (done) return;
      if (serverConnected && clientConnected) {
        done = true;
        clearTimeout(timer);
        resolve();
      }
    }

    pair.server.on('connect', function() { serverConnected = true; maybeResolve(); });
    pair.client.on('connect', function() { clientConnected = true; maybeResolve(); });
    pair.server.on('error', function(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error('server error: ' + err.message));
    });

    pair.server.listen(pair.server._port, function(err) {
      if (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error('listen failed: ' + err.message));
        return;
      }
      pair.client.connect('127.0.0.1', pair.server._port, function(cerr) {
        if (cerr) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(new Error('client connect failed: ' + cerr.message));
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testBasicRoundTrip() {
  console.log('\n── Test 1: basic round-trip ──');
  var pair = buildPair(randomPort());

  try {
    await waitConnected(pair);

    // Build a fake .als payload (not actually parseable, just bytes).
    var bytes = crypto.randomBytes(64 * 1024); // 64KB
    var expectedSha = crypto.createHash('sha256').update(bytes).digest('hex');

    // Peer B listens for remote save.
    var remoteSaves = [];
    pair.repB.on('remote_save', function(info) { remoteSaves.push(info); });

    // Peer A sends.
    var sent = pair.repA.sendSet(bytes, pair.pathA);
    t('sendSet returned true', sent === true);

    // Give TCP a moment.
    await sleep(200);

    t('peer B received exactly one remote_save', remoteSaves.length === 1,
      'got ' + remoteSaves.length);
    if (remoteSaves.length === 1) {
      t('sha matches', remoteSaves[0].sha256 === expectedSha,
        expectedSha + ' vs ' + remoteSaves[0].sha256);
      t('bytes match', remoteSaves[0].bytes === bytes.length);
      t('target path is peer B\'s .als', remoteSaves[0].path === pair.pathB);
    }

    // Verify the file on disk.
    var written = fs.readFileSync(pair.pathB);
    t('file on disk size matches', written.length === bytes.length);
    t('file on disk content matches',
      crypto.createHash('sha256').update(written).digest('hex') === expectedSha);

    // Stats sanity.
    t('peerA.sent === 1', pair.repA.stats.sent === 1);
    t('peerB.received === 1', pair.repB.stats.received === 1);
  } finally {
    destroyPair(pair);
  }
}

async function testEchoGuardSha() {
  console.log('\n── Test 2: sha echo guard ──');
  var pair = buildPair(randomPort(), { localSaveGraceMs: 0 });

  try {
    await waitConnected(pair);

    var bytes = crypto.randomBytes(4096);

    var receivedOnA = [];
    pair.repA.on('remote_save', function(info) { receivedOnA.push(info); });

    // Peer A sends → peer B receives
    pair.repA.sendSet(bytes, pair.pathA);
    await sleep(150);

    // Now peer B "echoes" the same bytes back. Peer A should drop it
    // because its sha is still in peer A's echoFifo.
    pair.repB.sendSet(bytes, pair.pathB);
    await sleep(150);

    t('peer A did not accept the echoed save', receivedOnA.length === 0,
      'received ' + receivedOnA.length + ' unexpected echoes');
    t('peer A dropped_echo_sha === 1', pair.repA.stats.dropped_echo_sha === 1,
      'got ' + pair.repA.stats.dropped_echo_sha);
  } finally {
    destroyPair(pair);
  }
}

async function testLocalSaveGraceWindow() {
  console.log('\n── Test 3: local-save grace window ──');
  // Two separate buffers (different shas) — but the receiver just
  // saved locally, so the incoming frame should be dropped by the
  // grace window.
  var pair = buildPair(randomPort(), { localSaveGraceMs: 2000 });

  try {
    await waitConnected(pair);

    // Peer B "just saved" locally by calling sendSet — this primes
    // _lastLocalSaveAt on peer B.
    var bytesB = crypto.randomBytes(2048);
    pair.repB.sendSet(bytesB, pair.pathB);
    await sleep(100);

    // Peer A now sends a DIFFERENT payload. The sha won't match
    // anything on peer B, but the grace window should still drop it.
    var bytesA = crypto.randomBytes(2048);
    var receivedOnB = [];
    pair.repB.on('remote_save', function(info) { receivedOnB.push(info); });
    pair.repA.sendSet(bytesA, pair.pathA);
    await sleep(200);

    t('peer B dropped incoming due to grace', receivedOnB.length === 0,
      'received ' + receivedOnB.length + ' unexpected saves');
    t('peer B dropped_grace_window === 1', pair.repB.stats.dropped_grace_window === 1,
      'got ' + pair.repB.stats.dropped_grace_window);
  } finally {
    destroyPair(pair);
  }
}

async function testOversizeDrop() {
  console.log('\n── Test 4: oversize drop ──');
  var pair = buildPair(randomPort(), { maxBytes: 8 * 1024 });

  try {
    await waitConnected(pair);

    var small = Buffer.alloc(1024);
    var big = Buffer.alloc(16 * 1024);

    var okSmall = pair.repA.sendSet(small, pair.pathA);
    var okBig = pair.repA.sendSet(big, pair.pathA);

    t('small send accepted', okSmall === true);
    t('big send rejected', okBig === false);
    t('peerA.stats.dropped_oversize === 1', pair.repA.stats.dropped_oversize === 1,
      'got ' + pair.repA.stats.dropped_oversize);
  } finally {
    destroyPair(pair);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== AlsReplicator Unit Tests ===');

  try {
    await testBasicRoundTrip();
    await testEchoGuardSha();
    await testLocalSaveGraceWindow();
    await testOversizeDrop();
  } catch (e) {
    console.log('\n!! HARNESS ERROR: ' + e.message);
    console.log(e.stack);
    fail++;
  }

  console.log('\n=== ' + pass + ' pass, ' + fail + ' fail ===');
  process.exit(fail === 0 ? 0 : 1);
}

run();

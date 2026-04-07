/**
 * m4l-notifier-test.js — unit test for the M4LNotifier dgram bridge.
 *
 * Binds an in-process UDP receiver on a random high port, points an
 * M4LNotifier at it, and verifies the wire format matches what
 * colab_livesync.js's applyDelta expects:
 *
 *   { u, t: 'nf', lv, tag, msg, d }
 *
 * No Max for Live, no real port 8001 — pure in-process unit test.
 *
 * Run: node test/m4l-notifier-test.js
 * Exit: 0 on success, 1 on any failure.
 */

var dgram = require('dgram');
var M4LNotifier = require('../js/hub/m4l-notifier');

var pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); pass++; }
  else    { console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

function bindReceiver(port) {
  return new Promise(function(resolve, reject) {
    var sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    var received = [];
    sock.on('message', function(msg, rinfo) {
      try {
        received.push({ json: JSON.parse(msg.toString('utf8')), bytes: msg.length, from: rinfo });
      } catch (e) {
        received.push({ raw: msg.toString('utf8'), parseError: e.message });
      }
    });
    sock.on('error', function(err) { reject(err); });
    sock.bind(port, '127.0.0.1', function() { resolve({ sock: sock, received: received }); });
  });
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function testBasicSend() {
  console.log('\n── Test 1: info / warn / err round-trip ──');
  var port = 41000 + Math.floor(Math.random() * 10000);
  var rx = await bindReceiver(port);

  var notifier = new M4LNotifier({ port: port, uid: 'test-engine' });

  notifier.info('peer saved: x.als (4.2 MB)', { name: 'x.als', bytes: 4400000 });
  notifier.warn('save throttle hit', null);
  notifier.err('write failed: EACCES', null);

  // dgram is async — give the kernel a moment.
  await sleep(150);

  t('received exactly 3 packets', rx.received.length === 3,
    'got ' + rx.received.length);

  if (rx.received.length === 3) {
    var info = rx.received[0].json;
    t('info: t === "nf"', info && info.t === 'nf');
    t('info: lv === "info"', info && info.lv === 'info');
    t('info: tag === "[INFO]"', info && info.tag === '[INFO]');
    t('info: msg correct', info && info.msg === 'peer saved: x.als (4.2 MB)');
    t('info: u === "test-engine"', info && info.u === 'test-engine');
    t('info: d.bytes === 4400000', info && info.d && info.d.bytes === 4400000);

    var warn = rx.received[1].json;
    t('warn: tag === "[WARN]"', warn && warn.tag === '[WARN]');
    t('warn: lv === "warn"', warn && warn.lv === 'warn');

    var err = rx.received[2].json;
    t('err: tag === "[ERR]"', err && err.tag === '[ERR]');
    t('err: lv === "err"', err && err.lv === 'err');
  }

  // Stats sanity.
  t('notifier.stats.sent === 3', notifier.stats.sent === 3);
  t('notifier.stats.errors === 0', notifier.stats.errors === 0);

  notifier.close();
  rx.sock.close();
}

async function testFormatBytes() {
  console.log('\n── Test 2: formatBytes helper ──');
  t('512 → "512 B"', M4LNotifier.formatBytes(512) === '512 B');
  t('1500 → "1.5 KB"', M4LNotifier.formatBytes(1500) === '1.5 KB');
  t('4_400_000 → "4.2 MB"', M4LNotifier.formatBytes(4400000) === '4.2 MB');
  t('2 GB → "2.00 GB"', M4LNotifier.formatBytes(2 * 1024 * 1024 * 1024) === '2.00 GB');
  t('NaN → "? B"', M4LNotifier.formatBytes(NaN) === '? B');
}

async function testCloseIsIdempotent() {
  console.log('\n── Test 3: close() is idempotent and post-close sends are no-ops ──');
  var port = 41000 + Math.floor(Math.random() * 10000);
  var rx = await bindReceiver(port);

  var notifier = new M4LNotifier({ port: port });
  notifier.info('first');
  await sleep(50);
  notifier.close();
  notifier.close(); // should not throw
  var ok = notifier.info('after close');
  await sleep(50);

  t('post-close info() returns false', ok === false);
  t('only the first packet arrived', rx.received.length === 1,
    'got ' + rx.received.length);

  rx.sock.close();
}

async function run() {
  console.log('=== M4LNotifier Unit Tests ===');
  try {
    await testBasicSend();
    await testFormatBytes();
    await testCloseIsIdempotent();
  } catch (e) {
    console.log('\n!! HARNESS ERROR: ' + e.message);
    console.log(e.stack);
    fail++;
  }
  console.log('\n=== ' + pass + ' pass, ' + fail + ' fail ===');
  process.exit(fail === 0 ? 0 : 1);
}

run();

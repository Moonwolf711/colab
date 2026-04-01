/**
 * WORST CASE STRESS TEST
 * Congested wifi, 4MB buffer, ports 8080 <-> 3030
 * Flood with latency measurement loop
 */

var TcpStack = require('../js/hub/tcp-stack');
var C = require('../js/shared/constants');
var protocol = require('../js/shared/protocol');

var BUFFER = 4 * 1024 * 1024;
var SERVER_PORT = 3030;
var FLOOD_ROUNDS = 50;
var MSGS_PER_ROUND = 100;
var BIG_FILE_SIZE = 2 * 1024 * 1024;
var ROUND_INTERVAL_MS = 10;

var latencies = [];
var dropped = 0;
var delivered = 0;
var errors = 0;
var filesRecv = 0;
var fileBytesRecv = 0;
var manifestsRecv = 0;
var statesRecv = 0;
var cursorsRecv = 0;
var backpressureHits = 0;
var startTime = 0;

var server = new TcpStack({ port: SERVER_PORT, sendBufferSize: BUFFER });
var client = new TcpStack({ port: SERVER_PORT, sendBufferSize: BUFFER });

// --- Server handlers ---

server.on('state', function(payload) {
  statesRecv++;
  if (payload.length >= 13) {
    var lo = payload.readUInt32LE(5);
    var hi = payload.readUInt32LE(9);
    var sentAt = hi * 0x100000000 + lo;
    if (sentAt > 0) {
      var lat = Date.now() - sentAt;
      if (lat >= 0 && lat < 30000) latencies.push(lat);
    }
  }
});

server.on('cursor', function() { cursorsRecv++; });
server.on('asset_manifest', function() { manifestsRecv++; });
server.on('asset_transfer', function(p) {
  filesRecv++;
  var f = TcpStack.parseFileTransfer(p);
  fileBytesRecv += f.data.length;
});
server.on('error', function() { errors++; });
server.on('backpressure', function() { backpressureHits++; });
client.on('error', function() { errors++; });
client.on('backpressure', function() { backpressureHits++; });

function buildTimestampedState(seq) {
  var buf = Buffer.alloc(13);
  buf[0] = C.PKT.STATE_UPDATE;
  buf.writeUInt32LE(seq, 1);
  var now = Date.now();
  buf.writeUInt32LE(now >>> 0, 5);
  buf.writeUInt32LE((now / 0x100000000) >>> 0, 9);
  return buf;
}

function runFlood() {
  startTime = Date.now();
  var round = 0;

  var interval = setInterval(function() {
    if (round >= FLOOD_ROUNDS) {
      clearInterval(interval);
      // Final big file burst
      for (var f = 0; f < 3; f++) {
        var bigFile = Buffer.alloc(BIG_FILE_SIZE, 0xAA + f);
        var ok = client.sendFile('Samples/flood_' + f + '.wav', bigFile);
        if (!ok) dropped++; else delivered++;
      }
      setTimeout(report, 5000);
      return;
    }

    for (var i = 0; i < MSGS_PER_ROUND; i++) {
      var ok1 = client.sendState(buildTimestampedState(round * MSGS_PER_ROUND + i));
      if (!ok1) dropped++; else delivered++;

      if (i % 5 === 0) {
        var cursorPkt = Buffer.from(protocol.buildCursorPacket(
          round * MSGS_PER_ROUND + i, round % 32, i % 16, true, 'flood-user'
        ));
        var ok2 = client.sendCursor(cursorPkt);
        if (!ok2) dropped++; else delivered++;
      }

      if (i % 20 === 0) {
        client.sendManifest({
          files: [
            { path: 'Samples/s' + i + '.wav', size: 44100 * i, hash: 'h' + i },
            { path: 'Presets/p' + i + '.adv', size: 1024, hash: 'p' + i }
          ],
          plugins: [{ name: 'Plugin' + i }]
        });
        delivered++;
      }
    }

    if (round % 5 === 0) {
      var medFile = Buffer.alloc(256 * 1024, round & 0xFF);
      var ok3 = client.sendFile('Samples/round_' + round + '.wav', medFile);
      if (!ok3) dropped++; else delivered++;
    }

    round++;
  }, ROUND_INTERVAL_MS);
}

function report() {
  var elapsed = Date.now() - startTime;

  latencies.sort(function(a, b) { return a - b; });
  var len = latencies.length;

  var pMin = len > 0 ? latencies[0] : -1;
  var avg  = len > 0 ? Math.round(latencies.reduce(function(s,v){return s+v;},0) / len * 100) / 100 : -1;
  var p50  = len > 0 ? latencies[Math.floor(len * 0.50)] : -1;
  var p90  = len > 0 ? latencies[Math.floor(len * 0.90)] : -1;
  var p95  = len > 0 ? latencies[Math.floor(len * 0.95)] : -1;
  var p99  = len > 0 ? latencies[Math.floor(len * 0.99)] : -1;
  var pMax = len > 0 ? latencies[len - 1] : -1;

  var cs = client.getStats();
  var ss = server.getStats();
  var throughput = Math.round(cs.counters.bytesSent / (elapsed / 1000));

  console.log('');
  console.log('+====================================================+');
  console.log('|   WORST CASE STRESS TEST -- CONGESTED WIFI          |');
  console.log('|   4MB buffer, ports 8080 <-> 3030, loopback         |');
  console.log('+====================================================+');
  console.log('|                                                      |');
  console.log('|  Duration:        ' + pad(elapsed + 'ms') + '|');
  console.log('|  Flood:           ' + pad(FLOOD_ROUNDS + ' rounds x ' + MSGS_PER_ROUND + ' msgs @ ' + ROUND_INTERVAL_MS + 'ms') + '|');
  console.log('|  + 13 file xfers  ' + pad('(10x 256KB + 3x 2MB)') + '|');
  console.log('|                                                      |');
  console.log('+----------------------------------------------------+');
  console.log('|  DELIVERY                                            |');
  console.log('|  Queued (sent):   ' + pad(String(delivered)) + '|');
  console.log('|  Dropped (backp): ' + pad(String(dropped)) + '|');
  console.log('|  Drop rate:       ' + pad(((dropped / (dropped + delivered)) * 100).toFixed(2) + '%') + '|');
  console.log('|  States recv:     ' + pad(String(statesRecv)) + '|');
  console.log('|  Cursors recv:    ' + pad(String(cursorsRecv)) + '|');
  console.log('|  Manifests recv:  ' + pad(String(manifestsRecv)) + '|');
  console.log('|  Files recv:      ' + pad(String(filesRecv)) + '|');
  console.log('|  File bytes:      ' + pad(fmtB(fileBytesRecv)) + '|');
  console.log('|  Backpressure:    ' + pad(backpressureHits + ' hits') + '|');
  console.log('|  Errors:          ' + pad(String(errors)) + '|');
  console.log('|                                                      |');
  console.log('+----------------------------------------------------+');
  console.log('|  LATENCY (state channel, ms)                         |');
  console.log('|  Samples:         ' + pad(String(len)) + '|');
  console.log('|  Min:             ' + pad(pMin + ' ms') + '|');
  console.log('|  Avg:             ' + pad(avg + ' ms') + '|');
  console.log('|  P50 (median):    ' + pad(p50 + ' ms') + '|');
  console.log('|  P90:             ' + pad(p90 + ' ms') + '|');
  console.log('|  P95:             ' + pad(p95 + ' ms') + '|');
  console.log('|  P99:             ' + pad(p99 + ' ms') + '|');
  console.log('|  MAX (worst):     ' + pad(pMax + ' ms') + '|');
  console.log('|                                                      |');
  console.log('+----------------------------------------------------+');
  console.log('|  THROUGHPUT                                           |');
  console.log('|  Client sent:     ' + pad(fmtB(cs.counters.bytesSent)) + '|');
  console.log('|  Server recv:     ' + pad(fmtB(ss.counters.bytesRecv)) + '|');
  console.log('|  Client frames:   ' + pad(cs.counters.framesSent + ' sent') + '|');
  console.log('|  Server frames:   ' + pad(ss.counters.framesRecv + ' recv') + '|');
  console.log('|  Throughput:      ' + pad(fmtB(throughput) + '/s') + '|');
  console.log('|  Peak send BW:    ' + pad(fmtB(cs.sendBps) + '/s') + '|');
  console.log('|  RTT:             ' + pad(cs.rttMs + ' ms') + '|');
  console.log('|                                                      |');
  console.log('+----------------------------------------------------+');

  // Histogram
  console.log('|  LATENCY HISTOGRAM                                   |');
  var buckets = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  var counts = new Array(buckets.length + 1).fill(0);
  for (var li = 0; li < len; li++) {
    var placed = false;
    for (var bi = 0; bi < buckets.length - 1; bi++) {
      if (latencies[li] >= buckets[bi] && latencies[li] < buckets[bi + 1]) {
        counts[bi]++;
        placed = true;
        break;
      }
    }
    if (!placed) counts[buckets.length - 1]++;
  }
  for (var bi = 0; bi < buckets.length; bi++) {
    var label = (bi < buckets.length - 1)
      ? '  ' + buckets[bi] + '-' + buckets[bi + 1] + 'ms'
      : '  ' + buckets[bi] + '+ms';
    var pct = len > 0 ? (counts[bi] / len * 100).toFixed(1) : '0.0';
    var bar = '';
    var barLen = Math.round(counts[bi] / Math.max(1, len) * 30);
    for (var x = 0; x < barLen; x++) bar += '#';
    console.log('|' + padL(label, 14) + padL(String(counts[bi]), 6) + '(' + padL(pct + '%', 7) + ') ' + pad(bar) + '|');
  }
  console.log('|                                                      |');
  console.log('+----------------------------------------------------+');

  var verdict;
  if (errors > 0) verdict = 'FAIL -- ' + errors + ' errors';
  else if (statesRecv === 0) verdict = 'FAIL -- zero state packets delivered';
  else if (pMax > 1000) verdict = 'DEGRADED -- max latency ' + pMax + 'ms (>1s)';
  else if (pMax > 200) verdict = 'WARN -- max latency ' + pMax + 'ms (>200ms)';
  else verdict = 'PASS -- stack survived worst-case flood';

  console.log('|  VERDICT:         ' + pad(verdict) + '|');
  console.log('|                                                      |');
  console.log('+====================================================+');

  server.destroy();
  client.destroy();
  process.exit(errors > 0 ? 1 : 0);
}

function pad(s) { s = String(s); while (s.length < 34) s += ' '; return s; }
function padL(s, w) { s = String(s); while (s.length < w) s += ' '; return s; }
function fmtB(b) {
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

// --- GO ---
console.log('WORST CASE FLOOD TEST');
console.log('Server: 0.0.0.0:3030  Client -> 127.0.0.1:3030');
console.log('Buffer: 4MB (congested wifi worst case)');
console.log('Flood:  ' + FLOOD_ROUNDS + ' rounds x ' + MSGS_PER_ROUND + ' msgs + 13 file transfers');
console.log('');

server.listen(SERVER_PORT, function(err) {
  if (err) { console.log('LISTEN FAIL: ' + err); process.exit(1); }
  console.log('Server listening on :' + SERVER_PORT);

  client.connect('127.0.0.1', SERVER_PORT, function(err) {
    if (err) { console.log('CONNECT FAIL: ' + err); process.exit(1); }
    console.log('Client connected from :8080 -> :3030');
    console.log('Starting flood...');
    runFlood();
  });
});

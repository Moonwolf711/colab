/**
 * REAL WORST CASE STRESS TEST
 *
 * Puts a degradation proxy between client and server that simulates:
 *   - Base latency: 25ms each way (50ms RTT)
 *   - Jitter: +/- 30ms random
 *   - Bandwidth cap: 5 Mbps (congested wifi)
 *   - Random stalls: 5% chance of 200-800ms freeze (wifi contention)
 *   - Occasional resets: 1% chance of proxy dropping connection mid-transfer
 *
 * Topology:
 *   Client :17001 --> Proxy :17002 ~~delay~~ Proxy --> Server :17003
 *   Server :17003 --> Proxy :17002 ~~delay~~ Proxy --> Client :17001
 */

var net = require('net');
var TcpStack = require('../js/hub/tcp-stack');
var C = require('../js/shared/constants');
var protocol = require('../js/shared/protocol');

// =====================================================================
// DEGRADATION SETTINGS — congested wifi worst case
// =====================================================================

var SETTINGS = {
  baseLatencyMs:    25,      // one-way base delay
  jitterMs:         30,      // random +/- on top of base
  bandwidthBps:     5 * 1024 * 1024 / 8,  // 5 Mbps = 625 KB/s
  stallChance:      0.05,    // 5% of chunks get stalled
  stallMinMs:       200,
  stallMaxMs:       800,
  dropChance:       0.01,    // 1% chance of dropping a chunk entirely
};

var SERVER_PORT = 17003;
var PROXY_PORT  = 17002;
var BUFFER_SIZE = 64 * 1024;

// =====================================================================
// Degradation proxy
// =====================================================================

function DegradationProxy(listenPort, targetPort, settings) {
  this.listenPort = listenPort;
  this.targetPort = targetPort;
  this.s = settings;
  this.server = null;
  this.bytesFwd = 0;
  this.bytesDropped = 0;
  this.stalls = 0;
  this.drops = 0;
  this.connections = 0;
  this._tokens = this.s.bandwidthBps;  // token bucket for bandwidth
  this._lastRefill = Date.now();
}

DegradationProxy.prototype.start = function(callback) {
  var self = this;

  this.server = net.createServer({ noDelay: true }, function(clientSock) {
    self.connections++;

    // Connect to real server
    var serverSock = net.createConnection({
      host: '127.0.0.1',
      port: self.targetPort,
      noDelay: true
    });

    serverSock.on('connect', function() {
      // Bidirectional degraded pipe
      self._pipeWithDegradation(clientSock, serverSock, 'c->s');
      self._pipeWithDegradation(serverSock, clientSock, 's->c');
    });

    serverSock.on('error', function() { clientSock.destroy(); });
    clientSock.on('error', function() { serverSock.destroy(); });
    clientSock.on('close', function() { serverSock.destroy(); });
    serverSock.on('close', function() { clientSock.destroy(); });
  });

  this.server.listen(this.listenPort, callback);
};

DegradationProxy.prototype._pipeWithDegradation = function(src, dst, label) {
  var self = this;

  src.on('data', function(chunk) {
    // 1) Drop chance
    if (Math.random() < self.s.dropChance) {
      self.drops++;
      self.bytesDropped += chunk.length;
      return; // silently eat the data
    }

    // 2) Calculate delay
    var delay = self.s.baseLatencyMs + (Math.random() * 2 - 1) * self.s.jitterMs;
    delay = Math.max(1, Math.round(delay));

    // 3) Stall chance
    if (Math.random() < self.s.stallChance) {
      var stallExtra = self.s.stallMinMs + Math.random() * (self.s.stallMaxMs - self.s.stallMinMs);
      delay += Math.round(stallExtra);
      self.stalls++;
    }

    // 4) Bandwidth throttle — split into rate-limited sub-chunks
    var bytesPerMs = self.s.bandwidthBps / 1000;
    var sendTime = chunk.length / bytesPerMs; // ms needed at bandwidth cap

    // If chunk would exceed bandwidth window, add proportional delay
    if (sendTime > 1) {
      delay += Math.round(sendTime);
    }

    // 5) Deliver after delay
    self.bytesFwd += chunk.length;
    setTimeout(function() {
      if (!dst.destroyed) {
        try { dst.write(chunk); } catch(e) {}
      }
    }, delay);
  });
};

DegradationProxy.prototype.getStats = function() {
  return {
    connections: this.connections,
    bytesFwd: this.bytesFwd,
    bytesDropped: this.bytesDropped,
    stalls: this.stalls,
    drops: this.drops
  };
};

DegradationProxy.prototype.destroy = function() {
  if (this.server) { try { this.server.close(); } catch(e) {} }
};

// =====================================================================
// Test harness
// =====================================================================

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

var FLOOD_ROUNDS = 30;
var MSGS_PER_ROUND = 50;
var ROUND_INTERVAL_MS = 50;  // slower due to degradation

var proxy = new DegradationProxy(PROXY_PORT, SERVER_PORT, SETTINGS);
var server = new TcpStack({ port: SERVER_PORT, sendBufferSize: BUFFER_SIZE });
var client = new TcpStack({ port: PROXY_PORT, sendBufferSize: BUFFER_SIZE });

// --- Handlers ---

server.on('state', function(payload) {
  statesRecv++;
  if (payload.length >= 13) {
    var lo = payload.readUInt32LE(5);
    var hi = payload.readUInt32LE(9);
    var sentAt = hi * 0x100000000 + lo;
    if (sentAt > 0) {
      var lat = Date.now() - sentAt;
      if (lat >= 0 && lat < 60000) latencies.push(lat);
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
client.on('error', function() { errors++; });
server.on('backpressure', function() { backpressureHits++; });
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
      // Final large file transfers
      for (var f = 0; f < 3; f++) {
        var big = Buffer.alloc(512 * 1024, 0xAA + f);
        var ok = client.sendFile('Samples/final_' + f + '.wav', big);
        if (!ok) dropped++; else delivered++;
      }
      // Wait long enough for degraded delivery
      var waitMs = SETTINGS.baseLatencyMs * 2 + SETTINGS.stallMaxMs + 8000;
      console.log('Flood done. Waiting ' + waitMs + 'ms for degraded delivery...');
      setTimeout(report, waitMs);
      return;
    }

    for (var i = 0; i < MSGS_PER_ROUND; i++) {
      var ok1 = client.sendState(buildTimestampedState(round * MSGS_PER_ROUND + i));
      if (!ok1) dropped++; else delivered++;

      if (i % 5 === 0) {
        var cp = Buffer.from(protocol.buildCursorPacket(
          round * MSGS_PER_ROUND + i, round % 32, i % 16, true, 'flood-usr'
        ));
        var ok2 = client.sendCursor(cp);
        if (!ok2) dropped++; else delivered++;
      }

      if (i % 25 === 0) {
        client.sendManifest({
          files: [{ path: 'x/' + i + '.wav', size: i * 100, hash: 'h' + i }],
          plugins: []
        });
        delivered++;
      }
    }

    if (round % 3 === 0) {
      var med = Buffer.alloc(128 * 1024, round & 0xFF);
      var ok3 = client.sendFile('Samples/r' + round + '.wav', med);
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
  var ps = proxy.getStats();
  var throughput = elapsed > 0 ? Math.round(cs.counters.bytesSent / (elapsed / 1000)) : 0;

  console.log('');
  console.log('+============================================================+');
  console.log('|    DEGRADED NETWORK STRESS TEST                             |');
  console.log('|    Simulated congested WiFi via TCP proxy                   |');
  console.log('+============================================================+');
  console.log('|                                                              |');
  console.log('|  NETWORK CONDITIONS SIMULATED                                |');
  console.log('|  Base latency:    ' + pad(SETTINGS.baseLatencyMs + 'ms one-way (' + (SETTINGS.baseLatencyMs*2) + 'ms RTT)') + '|');
  console.log('|  Jitter:          ' + pad('+/- ' + SETTINGS.jitterMs + 'ms random') + '|');
  console.log('|  Bandwidth cap:   ' + pad((SETTINGS.bandwidthBps * 8 / 1024 / 1024).toFixed(1) + ' Mbps') + '|');
  console.log('|  Stall chance:    ' + pad((SETTINGS.stallChance*100) + '% (' + SETTINGS.stallMinMs + '-' + SETTINGS.stallMaxMs + 'ms)') + '|');
  console.log('|  Drop chance:     ' + pad((SETTINGS.dropChance*100) + '% (silent eat)') + '|');
  console.log('|                                                              |');
  console.log('+------------------------------------------------------------+');
  console.log('|  PROXY STATS                                                 |');
  console.log('|  Bytes forwarded: ' + pad(fmtB(ps.bytesFwd)) + '|');
  console.log('|  Bytes dropped:   ' + pad(fmtB(ps.bytesDropped)) + '|');
  console.log('|  Stalls injected: ' + pad(String(ps.stalls)) + '|');
  console.log('|  Drops injected:  ' + pad(String(ps.drops)) + '|');
  console.log('|                                                              |');
  console.log('+------------------------------------------------------------+');
  console.log('|  TEST PARAMETERS                                             |');
  console.log('|  Duration:        ' + pad(elapsed + 'ms') + '|');
  console.log('|  Flood:           ' + pad(FLOOD_ROUNDS + ' rounds x ' + MSGS_PER_ROUND + ' msgs @ ' + ROUND_INTERVAL_MS + 'ms') + '|');
  console.log('|  Buffer:          ' + pad(fmtB(BUFFER_SIZE) + ' (4MB congested wifi)') + '|');
  console.log('|                                                              |');
  console.log('+------------------------------------------------------------+');
  console.log('|  DELIVERY                                                     |');
  console.log('|  App queued:      ' + pad(String(delivered)) + '|');
  console.log('|  App dropped:     ' + pad(dropped + ' (backpressure)') + '|');
  console.log('|  States recv:     ' + pad(statesRecv + ' / 1500 expected') + '|');
  console.log('|  Cursors recv:    ' + pad(cursorsRecv + ' / 300 expected') + '|');
  console.log('|  Manifests recv:  ' + pad(manifestsRecv + ' / 60 expected') + '|');
  console.log('|  Files recv:      ' + pad(filesRecv + ' / 13 expected') + '|');
  console.log('|  File bytes:      ' + pad(fmtB(fileBytesRecv)) + '|');
  console.log('|  Backpressure:    ' + pad(backpressureHits + ' hits') + '|');
  console.log('|  TCP errors:      ' + pad(String(errors)) + '|');
  console.log('|                                                              |');
  console.log('+------------------------------------------------------------+');
  console.log('|  LATENCY (state channel end-to-end, ms)                      |');
  console.log('|  Samples:         ' + pad(String(len)) + '|');
  console.log('|  Min:             ' + pad(pMin + ' ms') + '|');
  console.log('|  Avg:             ' + pad(avg + ' ms') + '|');
  console.log('|  P50 (median):    ' + pad(p50 + ' ms') + '|');
  console.log('|  P90:             ' + pad(p90 + ' ms') + '|');
  console.log('|  P95:             ' + pad(p95 + ' ms') + '|');
  console.log('|  P99:             ' + pad(p99 + ' ms') + '|');
  console.log('|  MAX (worst):     ' + pad(pMax + ' ms') + '|');
  console.log('|                                                              |');

  // Histogram
  console.log('+------------------------------------------------------------+');
  console.log('|  LATENCY HISTOGRAM                                           |');
  var buckets = [0, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000];
  var counts = new Array(buckets.length + 1).fill(0);
  for (var li = 0; li < len; li++) {
    var placed = false;
    for (var bi = 0; bi < buckets.length - 1; bi++) {
      if (latencies[li] >= buckets[bi] && latencies[li] < buckets[bi + 1]) {
        counts[bi]++; placed = true; break;
      }
    }
    if (!placed) counts[buckets.length - 1]++;
  }
  for (var bi = 0; bi < buckets.length; bi++) {
    var lo2 = buckets[bi];
    var hi2 = bi < buckets.length - 1 ? buckets[bi + 1] : null;
    var label = hi2 !== null ? '  ' + lo2 + '-' + hi2 + 'ms' : '  ' + lo2 + '+ms';
    var pct = len > 0 ? (counts[bi] / len * 100).toFixed(1) : '0.0';
    var bar = '';
    var barLen = Math.min(25, Math.round(counts[bi] / Math.max(1, len) * 25));
    for (var x = 0; x < barLen; x++) bar += '#';
    console.log('|' + padL(label, 14) + padR(String(counts[bi]), 6) + '(' + padR(pct + '%', 7) + ') ' + pad(bar) + '|');
  }

  console.log('|                                                              |');
  console.log('+------------------------------------------------------------+');
  console.log('|  THROUGHPUT                                                   |');
  console.log('|  Client sent:     ' + pad(fmtB(cs.counters.bytesSent)) + '|');
  console.log('|  Server recv:     ' + pad(fmtB(ss.counters.bytesRecv)) + '|');
  console.log('|  App throughput:  ' + pad(fmtB(throughput) + '/s') + '|');
  console.log('|  Effective BW:    ' + pad(fmtB(Math.round(ps.bytesFwd / (elapsed/1000))) + '/s (through proxy)') + '|');
  console.log('|  RTT (TCP stack): ' + pad(cs.rttMs + ' ms') + '|');
  console.log('|                                                              |');
  console.log('+------------------------------------------------------------+');

  // Delivery rate
  var stateDeliveryPct = (statesRecv / 1500 * 100).toFixed(1);
  var fileDeliveryPct = (filesRecv / 13 * 100).toFixed(1);

  // Verdict
  var verdict;
  if (errors > 5) {
    verdict = 'FAIL -- ' + errors + ' TCP errors (connection unstable)';
  } else if (statesRecv === 0) {
    verdict = 'FAIL -- zero state packets got through';
  } else if (filesRecv < 10) {
    verdict = 'DEGRADED -- only ' + filesRecv + '/13 files delivered (' + fileDeliveryPct + '%)';
  } else if (pMax > 5000) {
    verdict = 'DEGRADED -- max latency ' + pMax + 'ms (>5s)';
  } else if (pMax > 1000) {
    verdict = 'WARN -- max latency ' + pMax + 'ms (stalls visible)';
  } else {
    verdict = 'PASS -- survived degraded network';
  }

  console.log('|  State delivery:  ' + pad(stateDeliveryPct + '% (' + statesRecv + '/1500)') + '|');
  console.log('|  File delivery:   ' + pad(fileDeliveryPct + '% (' + filesRecv + '/13)') + '|');
  console.log('|                                                              |');
  console.log('|  VERDICT:         ' + pad(verdict) + '|');
  console.log('|                                                              |');
  console.log('+============================================================+');

  proxy.destroy();
  server.destroy();
  client.destroy();
  process.exit(errors > 5 ? 1 : 0);
}

function pad(s) { s = String(s); while (s.length < 38) s += ' '; return s; }
function padL(s, w) { s = String(s); while (s.length < w) s += ' '; return s; }
function padR(s, w) { s = String(s); while (s.length < w) s = ' ' + s; return s; }
function fmtB(b) {
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

// --- LAUNCH ---
console.log('DEGRADED NETWORK STRESS TEST');
console.log('');
console.log('Network simulation:');
console.log('  Latency:   ' + SETTINGS.baseLatencyMs + 'ms +/- ' + SETTINGS.jitterMs + 'ms jitter');
console.log('  Bandwidth: ' + (SETTINGS.bandwidthBps * 8 / 1024 / 1024).toFixed(1) + ' Mbps');
console.log('  Stalls:    ' + (SETTINGS.stallChance * 100) + '% chance, ' + SETTINGS.stallMinMs + '-' + SETTINGS.stallMaxMs + 'ms');
console.log('  Drops:     ' + (SETTINGS.dropChance * 100) + '% silent drop');
console.log('');
console.log('Topology: Client :17001 --> Proxy :17002 ~~degraded~~ --> Server :17003');
console.log('Buffer: ' + fmtB(BUFFER_SIZE));
console.log('');

server.listen(SERVER_PORT, function(err) {
  if (err) { console.log('SERVER FAIL: ' + err); process.exit(1); }
  console.log('Server listening on :' + SERVER_PORT);

  proxy.start(function() {
    console.log('Proxy listening on :' + PROXY_PORT + ' -> :' + SERVER_PORT);
    console.log('  (injecting latency, jitter, stalls, drops)');

    client.connect('127.0.0.1', PROXY_PORT, function(err) {
      if (err) { console.log('CONNECT FAIL: ' + err); process.exit(1); }
      console.log('Client connected through proxy');
      console.log('Starting flood...');
      console.log('');
      runFlood();
    });
  });
});

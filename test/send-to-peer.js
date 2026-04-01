/**
 * DIRECT SEND TO 192.168.0.83
 *
 * Sends real coLaB data across the LAN to another machine.
 * Server listens on 192.168.0.83:19090 (remote).
 * This script is the client on 192.168.0.3 sending TO that machine.
 *
 * If no server is running on .83, we also try raw TCP to prove
 * the packets actually leave our NIC and hit the remote host.
 */

var net = require('net');
var TcpStack = require('../js/hub/tcp-stack');
var C = require('../js/shared/constants');
var protocol = require('../js/shared/protocol');

var LOCAL_IP  = '192.168.0.3';
var REMOTE_IP = '192.168.0.83';
var PORT = 19090;
var BUFFER = 64 * 1024;

var sentPackets = [];
var errors = [];
var startTime = Date.now();

// =====================================================================
// PHASE 1: Raw TCP probe — prove we can reach the port
// =====================================================================

function rawTcpProbe(callback) {
  console.log('PHASE 1: Raw TCP probe to ' + REMOTE_IP + ':' + PORT);
  console.log('');

  var sock = new net.Socket();
  sock.setTimeout(3000);

  sock.on('connect', function() {
    console.log('  TCP CONNECTED to ' + REMOTE_IP + ':' + PORT);
    console.log('  Local endpoint: ' + sock.localAddress + ':' + sock.localPort);
    console.log('  Remote endpoint: ' + sock.remoteAddress + ':' + sock.remotePort);

    // Send a raw hello so we can see it in Wireshark on the other end
    var hello = Buffer.from('coLaB-probe-from-' + LOCAL_IP + '\n');
    sock.write(hello);
    console.log('  Sent ' + hello.length + ' byte probe');
    sock.destroy();
    callback(true);
  });

  sock.on('timeout', function() {
    console.log('  TCP TIMEOUT — no listener on ' + REMOTE_IP + ':' + PORT);
    console.log('  (This is expected if nothing is running on .83 yet)');
    sock.destroy();
    callback(false);
  });

  sock.on('error', function(err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('  TCP REFUSED — host is up but port ' + PORT + ' closed');
      console.log('  (Run node test/peer-server.js on 192.168.0.83 to listen)');
    } else {
      console.log('  TCP ERROR: ' + err.code + ' — ' + err.message);
    }
    sock.destroy();
    callback(false);
  });

  sock.connect(PORT, REMOTE_IP);
}

// =====================================================================
// PHASE 2: TcpStack connect + send real coLaB data
// =====================================================================

function tcpStackSend() {
  console.log('');
  console.log('PHASE 2: TcpStack connect to ' + REMOTE_IP + ':' + PORT);
  console.log('');

  var client = new TcpStack({ port: PORT, sendBufferSize: BUFFER });

  client.on('error', function(e) {
    errors.push(e.message || e.code || String(e));
  });

  client.on('rtt', function(ms) {
    console.log('  RTT measured: ' + ms + 'ms');
  });

  client.on('disconnect', function(reason) {
    console.log('  Disconnected: ' + reason);
  });

  client.connect(REMOTE_IP, PORT, function(err) {
    if (err) {
      console.log('  TcpStack CONNECT FAILED: ' + (err.message || err));
      console.log('');
      console.log('  To receive these packets, run on 192.168.0.83:');
      console.log('    node test/peer-server.js');
      console.log('');
      fallbackUdpBlast();
      return;
    }

    console.log('  TcpStack CONNECTED to ' + REMOTE_IP + ':' + PORT);
    console.log('  Sending coLaB data...');
    console.log('');

    // --- Send one of everything ---

    // 1) State updates
    for (var i = 0; i < 10; i++) {
      var stateBuf = Buffer.alloc(13);
      stateBuf[0] = C.PKT.STATE_UPDATE;
      stateBuf.writeUInt32LE(i, 1);
      var now = Date.now();
      stateBuf.writeUInt32LE(now >>> 0, 5);
      stateBuf.writeUInt32LE((now / 0x100000000) >>> 0, 9);
      client.sendState(stateBuf);
      sentPackets.push({ type: 'STATE_UPDATE', seq: i, size: 18 });
    }
    console.log('  Sent 10 STATE_UPDATE packets (CH.STATE)');

    // 2) Cursor updates
    for (var c = 0; c < 5; c++) {
      var cursorPkt = Buffer.from(protocol.buildCursorPacket(c, c * 2, c, true, 'tyler'));
      client.sendCursor(cursorPkt);
      sentPackets.push({ type: 'CURSOR_UPDATE', track: c * 2, scene: c, size: 18 });
    }
    console.log('  Sent 5 CURSOR_UPDATE packets (CH.STATE)');

    // 3) Manifest
    client.sendManifest({
      files: [
        { path: 'Samples/Collected/kick_808.wav', size: 44100, hash: 'a1b2c3d4' },
        { path: 'Samples/Collected/snare_tight.wav', size: 88200, hash: 'e5f6a7b8' },
        { path: 'Presets/Serum/bass_wobble.fxp', size: 4096, hash: 'c9d0e1f2' }
      ],
      plugins: [
        { name: 'Serum', className: 'Vst3PluginDevice', track: 'Bass' },
        { name: 'Pro-Q 3', className: 'Vst3PluginDevice', track: 'Master' }
      ]
    });
    sentPackets.push({ type: 'ASSET_MANIFEST', size: 'json' });
    console.log('  Sent 1 ASSET_MANIFEST (CH.DATA) — 3 files, 2 plugins');

    // 4) File transfer — 128KB sample
    var sampleData = Buffer.alloc(128 * 1024);
    for (var s = 0; s < sampleData.length; s++) sampleData[s] = s & 0xFF;
    client.sendFile('Samples/Collected/pad_lush_128k.wav', sampleData);
    sentPackets.push({ type: 'ASSET_TRANSFER', path: 'Samples/Collected/pad_lush_128k.wav', size: 128 * 1024 });
    console.log('  Sent 1 ASSET_TRANSFER (CH.DATA) — 128KB file');

    // 5) Ping
    client.sendPing();
    sentPackets.push({ type: 'PING', size: 18 });
    console.log('  Sent 1 PING (CH.CONTROL)');

    console.log('');
    console.log('  Waiting for responses...');

    setTimeout(function() {
      var stats = client.getStats();
      report(stats);
      client.disconnect();
      setTimeout(function() { client.destroy(); process.exit(0); }, 500);
    }, 4000);
  });
}

// =====================================================================
// PHASE 2 FALLBACK: UDP blast (if TCP port is closed)
// =====================================================================

function fallbackUdpBlast() {
  var dgram = require('dgram');
  console.log('PHASE 2 FALLBACK: Raw UDP blast to ' + REMOTE_IP);
  console.log('  (No TCP listener, so sending UDP probes you can see in Wireshark)');
  console.log('');

  var sock = dgram.createSocket('udp4');

  var ports = [C.STATE_PORT, C.DATA_PORT, PORT, 8080, 3030];
  var count = 0;

  ports.forEach(function(port) {
    // Send a discovery beacon
    var beacon = Buffer.from(protocol.buildDiscoveryBeacon(count++, {
      userName: 'tyler',
      sessionId: 'colab-probe-' + Date.now(),
      trackCount: 33,
      sourceIp: LOCAL_IP
    }));
    sock.send(beacon, 0, beacon.length, port, REMOTE_IP, function(err) {
      if (err) {
        console.log('  UDP to :' + port + ' — ERROR: ' + err.message);
      } else {
        console.log('  UDP to :' + port + ' — sent ' + beacon.length + ' byte discovery beacon');
        sentPackets.push({ type: 'DISCOVERY_BEACON (UDP)', port: port, size: beacon.length });
      }
    });

    // Send a state packet
    var state = Buffer.alloc(13);
    state[0] = C.PKT.STATE_UPDATE;
    state.writeUInt32LE(count, 1);
    var now = Date.now();
    state.writeUInt32LE(now >>> 0, 5);
    state.writeUInt32LE((now / 0x100000000) >>> 0, 9);
    sock.send(state, 0, state.length, port, REMOTE_IP, function(err) {
      if (err) {
        console.log('  UDP state to :' + port + ' — ERROR');
      } else {
        console.log('  UDP state to :' + port + ' — sent ' + state.length + ' bytes');
        sentPackets.push({ type: 'STATE_UPDATE (UDP)', port: port, size: state.length });
      }
    });
  });

  setTimeout(function() {
    sock.close();
    report(null);
    process.exit(0);
  }, 2000);
}

// =====================================================================
// Report
// =====================================================================

function report(tcpStats) {
  var elapsed = Date.now() - startTime;

  console.log('');
  console.log('+================================================================+');
  console.log('|    DIRECT SEND: ' + LOCAL_IP + ' → ' + REMOTE_IP + '                |');
  console.log('|    Port: ' + PORT + '  Buffer: ' + (BUFFER / 1024) + 'KB                                  |');
  console.log('+================================================================+');
  console.log('|                                                                  |');
  console.log('|  PACKETS SENT                                                    |');

  var totalBytes = 0;
  for (var i = 0; i < sentPackets.length; i++) {
    var p = sentPackets[i];
    var detail = p.type;
    if (p.path) detail += ' "' + p.path + '"';
    if (p.port) detail += ' :' + p.port;
    if (typeof p.size === 'number') {
      detail += ' (' + fmtB(p.size) + ')';
      totalBytes += p.size;
    }
    if (p.seq !== undefined) detail += ' seq=' + p.seq;
    if (p.track !== undefined) detail += ' track=' + p.track + ' scene=' + p.scene;
    console.log('|    ' + padR(String(i + 1) + '.', 4) + padR(detail, 58) + '|');
  }

  console.log('|                                                                  |');
  console.log('|  Total packets:   ' + padR(String(sentPackets.length), 43) + '|');
  if (totalBytes > 0) {
    console.log('|  Total app bytes: ' + padR(fmtB(totalBytes), 43) + '|');
  }
  console.log('|  Duration:        ' + padR(elapsed + 'ms', 43) + '|');
  console.log('|  Errors:          ' + padR(errors.length > 0 ? errors.join(', ') : 'none', 43) + '|');

  if (tcpStats) {
    console.log('|                                                                  |');
    console.log('|  TCP STACK STATS                                                 |');
    console.log('|  Connected:       ' + padR(String(tcpStats.connected), 43) + '|');
    console.log('|  Peer:            ' + padR((tcpStats.peerAddress || 'n/a') + ':' + (tcpStats.peerPort || 'n/a'), 43) + '|');
    console.log('|  Frames sent:     ' + padR(String(tcpStats.counters.framesSent), 43) + '|');
    console.log('|  Frames recv:     ' + padR(String(tcpStats.counters.framesRecv), 43) + '|');
    console.log('|  Bytes sent:      ' + padR(fmtB(tcpStats.counters.bytesSent), 43) + '|');
    console.log('|  Bytes recv:      ' + padR(fmtB(tcpStats.counters.bytesRecv), 43) + '|');
    console.log('|  RTT:             ' + padR(tcpStats.rttMs + ' ms', 43) + '|');
    console.log('|  Send BW:         ' + padR(fmtB(tcpStats.sendBps) + '/s', 43) + '|');
  }

  console.log('|                                                                  |');
  console.log('|  VERIFY WITH WIRESHARK:                                           |');
  console.log('|  On ' + REMOTE_IP + ': capture on NIC, filter:                       |');
  console.log('|    tcp.port == ' + PORT + ' || udp.port == ' + C.STATE_PORT + '                               |');
  console.log('|                                                                  |');
  console.log('+================================================================+');
}

function padR(s, w) { s = String(s); while (s.length < w) s += ' '; return s; }
function fmtB(b) {
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

// =====================================================================
// ALSO: generate a server script the remote machine can run
// =====================================================================

var fs = require('fs');
var serverScript = [
  '// Run this on 192.168.0.83 to receive coLaB packets',
  '// Usage: node peer-server.js',
  '',
  'var TcpStack = require("../js/hub/tcp-stack");',
  'var C = require("../js/shared/constants");',
  '',
  'var PORT = ' + PORT + ';',
  'var server = new TcpStack({ port: PORT, sendBufferSize: 64 * 1024 });',
  '',
  'server.on("state", function(p) {',
  '  var type = p[0] === C.PKT.STATE_UPDATE ? "STATE" : p[0] === C.PKT.CURSOR_UPDATE ? "CURSOR" : "0x" + p[0].toString(16);',
  '  console.log("[RECV] " + type + " seq=" + p.readUInt32LE(1) + " (" + p.length + " bytes)");',
  '});',
  'server.on("cursor", function(p) {',
  '  console.log("[RECV] CURSOR track=" + p[5] + " scene=" + p[6] + " editing=" + (p[7]===1));',
  '});',
  'server.on("asset_manifest", function(p) {',
  '  var m = JSON.parse(p.toString("utf8"));',
  '  console.log("[RECV] MANIFEST — " + m.files.length + " files, " + (m.plugins||[]).length + " plugins");',
  '});',
  'server.on("asset_transfer", function(p) {',
  '  var pathLen = p.readUInt16LE(0);',
  '  var path = p.slice(2, 2 + pathLen).toString("utf8");',
  '  var dataLen = p.length - 2 - pathLen;',
  '  console.log("[RECV] FILE \\"" + path + "\\" — " + dataLen + " bytes");',
  '});',
  'server.on("rtt", function(ms) { console.log("[RTT] " + ms + "ms"); });',
  'server.on("connect", function(info) { console.log("[CONNECTED] " + info.address + ":" + info.port); });',
  'server.on("disconnect", function(r) { console.log("[DISCONNECTED] " + r); });',
  '',
  'server.listen(PORT, function(err) {',
  '  if (err) { console.log("FAIL: " + err); process.exit(1); }',
  '  console.log("coLaB peer server listening on 0.0.0.0:" + PORT);',
  '  console.log("Waiting for packets from 192.168.0.3...");',
  '});',
  ''
].join('\n');

fs.writeFileSync(__dirname + '/peer-server.js', serverScript);
console.log('Generated test/peer-server.js — copy to 192.168.0.83 and run it');
console.log('');

// =====================================================================
// GO
// =====================================================================

rawTcpProbe(function(reachable) {
  if (reachable) {
    tcpStackSend();
  } else {
    tcpStackSend(); // try anyway — maybe just no listener yet
  }
});

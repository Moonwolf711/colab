/**
 * LIVE LAN TEST: 192.168.0.3 → 192.168.0.83 (TheHAVEN)
 * peer-server.js is running on .83:19090
 */

var TcpStack = require('../js/hub/tcp-stack');
var C = require('../js/shared/constants');
var protocol = require('../js/shared/protocol');

var REMOTE = '192.168.0.83';
var PORT = 19090;

var client = new TcpStack({ port: PORT, sendBufferSize: 64 * 1024 });
var sentCount = 0;
var recvCount = 0;
var rttSamples = [];

client.on('error', function(e) { console.log('[ERROR] ' + (e.message || e)); });
client.on('rtt', function(ms) { rttSamples.push(ms); console.log('  [RTT] ' + ms + 'ms'); });
client.on('state', function() { recvCount++; });
client.on('heartbeat_ack', function() { recvCount++; });

console.log('Connecting to TheHAVEN at ' + REMOTE + ':' + PORT + '...');

client.connect(REMOTE, PORT, function(err) {
  if (err) {
    console.log('CONNECT FAILED: ' + err);
    process.exit(1);
  }

  var stats = client.getStats();
  console.log('CONNECTED to ' + stats.peerAddress + ':' + stats.peerPort);
  console.log('');

  // --- Send everything ---

  // 1) 20 state updates
  console.log('Sending 20 STATE_UPDATE packets...');
  for (var i = 0; i < 20; i++) {
    var buf = Buffer.alloc(13);
    buf[0] = C.PKT.STATE_UPDATE;
    buf.writeUInt32LE(i, 1);
    var now = Date.now();
    buf.writeUInt32LE(now >>> 0, 5);
    buf.writeUInt32LE((now / 0x100000000) >>> 0, 9);
    client.sendState(buf);
    sentCount++;
  }

  // 2) 10 cursor updates
  console.log('Sending 10 CURSOR_UPDATE packets...');
  for (var c = 0; c < 10; c++) {
    var cp = Buffer.from(protocol.buildCursorPacket(c, c * 3, c, true, 'tyler'));
    client.sendCursor(cp);
    sentCount++;
  }

  // 3) Manifest with real-looking data
  console.log('Sending ASSET_MANIFEST...');
  client.sendManifest({
    files: [
      { path: 'Samples/Collected/kick_808.wav', size: 44100, hash: 'a1b2c3d4' },
      { path: 'Samples/Collected/snare_tight.wav', size: 88200, hash: 'e5f6a7b8' },
      { path: 'Samples/Collected/hihat_closed.wav', size: 22050, hash: '11223344' },
      { path: 'Samples/Collected/bass_sub.wav', size: 176400, hash: '55667788' },
      { path: 'Presets/Serum/wobble_bass.fxp', size: 4096, hash: 'aabbccdd' }
    ],
    plugins: [
      { name: 'Serum', className: 'Vst3PluginDevice', track: 'Bass' },
      { name: 'Pro-Q 3', className: 'Vst3PluginDevice', track: 'Master' },
      { name: 'OTT', className: 'Vst3PluginDevice', track: 'Synth Lead' }
    ]
  });
  sentCount++;

  // 4) 128KB file transfer
  console.log('Sending 128KB file transfer...');
  var fileData = Buffer.alloc(128 * 1024);
  for (var f = 0; f < fileData.length; f++) fileData[f] = f & 0xFF;
  client.sendFile('Samples/Collected/pad_warm_128k.wav', fileData);
  sentCount++;

  // 5) 512KB file transfer
  console.log('Sending 512KB file transfer...');
  var bigFile = Buffer.alloc(512 * 1024, 0xBE);
  client.sendFile('Samples/Collected/atmosphere_long.wav', bigFile);
  sentCount++;

  // 6) Pings for RTT
  console.log('Sending pings...');
  client.sendPing();

  // Wait and report
  setTimeout(function() {
    client.sendPing(); // one more ping after data settles

    setTimeout(function() {
      var s = client.getStats();

      console.log('');
      console.log('+================================================================+');
      console.log('|  LIVE LAN TRANSFER: 192.168.0.3 → 192.168.0.83 (TheHAVEN)      |');
      console.log('+================================================================+');
      console.log('|                                                                  |');
      console.log('|  Connection                                                      |');
      console.log('|    Local:  192.168.0.3 (this machine)                            |');
      console.log('|    Remote: ' + pad(s.peerAddress + ':' + s.peerPort) + '|');
      console.log('|    Status: ' + pad(s.connected ? 'ESTABLISHED' : 'DISCONNECTED') + '|');
      console.log('|                                                                  |');
      console.log('|  Packets sent                                                    |');
      console.log('|    STATE_UPDATE:   20                                            |');
      console.log('|    CURSOR_UPDATE:  10                                            |');
      console.log('|    ASSET_MANIFEST: 1 (5 files, 3 plugins)                       |');
      console.log('|    ASSET_TRANSFER: 2 (128KB + 512KB = 640KB)                    |');
      console.log('|    PING:           2                                             |');
      console.log('|    Total:          ' + pad(String(sentCount + 2)) + '|');
      console.log('|                                                                  |');
      console.log('|  Wire stats                                                      |');
      console.log('|    Frames sent:    ' + pad(String(s.counters.framesSent)) + '|');
      console.log('|    Frames recv:    ' + pad(String(s.counters.framesRecv)) + '|');
      console.log('|    Bytes sent:     ' + pad(fmtB(s.counters.bytesSent)) + '|');
      console.log('|    Bytes recv:     ' + pad(fmtB(s.counters.bytesRecv)) + '|');
      console.log('|    Errors:         ' + pad(String(s.counters.errors)) + '|');
      console.log('|                                                                  |');
      console.log('|  RTT (real LAN round-trip)                                       |');
      for (var r = 0; r < rttSamples.length; r++) {
        console.log('|    Sample ' + (r+1) + ':       ' + pad(rttSamples[r] + ' ms') + '|');
      }
      if (rttSamples.length > 0) {
        var avg = rttSamples.reduce(function(a,b){return a+b},0) / rttSamples.length;
        console.log('|    Average:        ' + pad(avg.toFixed(2) + ' ms') + '|');
      }
      console.log('|    Stack RTT:      ' + pad(s.rttMs + ' ms') + '|');
      console.log('|                                                                  |');
      console.log('+================================================================+');

      client.disconnect();
      setTimeout(function() { client.destroy(); process.exit(0); }, 500);
    }, 2000);
  }, 3000);
});

function pad(s) { s = String(s); while (s.length < 50) s += ' '; return s; }
function fmtB(b) {
  if (b >= 1024 * 1024) return (b / (1024*1024)).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

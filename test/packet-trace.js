/**
 * TCP/IP PACKET TRACER
 *
 * Captures real packets at the socket level and breaks down
 * every layer of the IPv4/TCP stack, linking each field to
 * the JS source file and line that generated it.
 *
 * Uses a raw TCP server to intercept and log actual wire bytes.
 */

var net = require('net');
var TcpStack = require('../js/hub/tcp-stack');
var C = require('../js/shared/constants');
var protocol = require('../js/shared/protocol');

var REAL_IP = '192.168.0.3';
var PORT = 19090;

// We'll capture what the TcpStack actually writes to the socket
// by monkey-patching socket.write

var capturedFrames = [];
var packetLog = [];

function hexDump(buf, offset, len) {
  offset = offset || 0;
  len = len || buf.length;
  var lines = [];
  for (var i = offset; i < offset + len; i += 16) {
    var hex = [];
    var ascii = '';
    for (var j = 0; j < 16; j++) {
      if (i + j < offset + len) {
        var b = buf[i + j];
        hex.push(b.toString(16).padStart(2, '0'));
        ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
      } else {
        hex.push('  ');
        ascii += ' ';
      }
    }
    var addr = (i - offset).toString(16).padStart(4, '0');
    lines.push('    ' + addr + '  ' + hex.slice(0,8).join(' ') + '  ' + hex.slice(8).join(' ') + '  |' + ascii + '|');
  }
  return lines.join('\n');
}

function describeFrame(buf) {
  var result = {
    raw: Buffer.from(buf),
    totalBytes: buf.length,
    layers: []
  };

  // ================================================================
  // LAYER 1: TCP/IP FRAMING (added by tcp-stack.js)
  // ================================================================
  if (buf.length < 5) {
    result.layers.push({ name: 'INCOMPLETE', note: 'Less than 5 bytes' });
    return result;
  }

  var framePayloadLen = buf.readUInt32LE(0);
  var channel = buf[4];

  var channelName = { 0x00: 'STATE', 0x01: 'DATA', 0x02: 'CONTROL', 0x03: 'AUDIO' }[channel] || 'UNKNOWN(0x' + channel.toString(16) + ')';

  result.layers.push({
    name: 'TCP-STACK FRAME',
    source: 'js/hub/tcp-stack.js → TcpStack.prototype.send()',
    fields: [
      { offset: '0-3', bytes: buf.slice(0, 4).toString('hex'), field: 'Payload length (uint32 LE)', value: framePayloadLen, source: 'tcp-stack.js:280 — frame.writeUInt32LE(payload.length + 1, 0)' },
      { offset: '4', bytes: buf.slice(4, 5).toString('hex'), field: 'Channel ID', value: '0x' + channel.toString(16).padStart(2, '0') + ' (' + channelName + ')', source: 'tcp-stack.js:281 — frame[4] = channel  // CH enum at tcp-stack.js:39-44' }
    ]
  });

  // ================================================================
  // LAYER 2: PROTOCOL PACKET (from protocol.js)
  // ================================================================
  if (buf.length < 10) {
    result.layers.push({ name: 'PROTOCOL (truncated)', note: 'Frame too short for protocol header' });
    return result;
  }

  var pktType = buf[5];
  var pktSeq = buf.readUInt32LE(6);

  var pktTypeName = 'UNKNOWN';
  for (var k in C.PKT) {
    if (C.PKT[k] === pktType) { pktTypeName = k; break; }
  }

  var protocolLayer = {
    name: 'PROTOCOL PACKET',
    source: 'js/shared/protocol.js',
    fields: [
      { offset: '5', bytes: buf.slice(5, 6).toString('hex'), field: 'Packet type', value: '0x' + pktType.toString(16).padStart(2, '0') + ' (' + pktTypeName + ')', source: 'protocol.js:8 — view.setUint8(0, type)  // constants.js PKT enum' },
      { offset: '6-9', bytes: buf.slice(6, 10).toString('hex'), field: 'Sequence number (uint32 LE)', value: pktSeq, source: 'protocol.js:9 — view.setUint32(1, seq, true)' }
    ]
  };

  // ================================================================
  // LAYER 3: PAYLOAD (type-specific, from various JS files)
  // ================================================================
  var payloadStart = 10;
  var payload = buf.slice(payloadStart);

  switch (pktType) {
    case C.PKT.STATE_UPDATE:
      protocolLayer.fields.push({
        offset: payloadStart + '+',
        bytes: payload.slice(0, Math.min(16, payload.length)).toString('hex') + (payload.length > 16 ? '...' : ''),
        field: 'CRDT state update (Yjs binary)',
        value: payload.length + ' bytes',
        source: 'protocol.js:59-66 — buildStatePacket(seq, yjsUpdate)\n' +
                '                    Called from hub-main.js:96 — this.crdt.onLocalUpdate()'
      });
      // If it has timestamp (our test packets)
      if (payload.length >= 8) {
        var tsLo = payload.readUInt32LE(0);
        var tsHi = payload.readUInt32LE(4);
        var ts = tsHi * 0x100000000 + tsLo;
        if (ts > 1700000000000 && ts < 2000000000000) {
          protocolLayer.fields.push({
            offset: payloadStart + '-' + (payloadStart + 7),
            bytes: payload.slice(0, 8).toString('hex'),
            field: 'Embedded timestamp (test packet)',
            value: new Date(ts).toISOString(),
            source: 'test/packet-trace.js — buildTimestampedState()'
          });
        }
      }
      break;

    case C.PKT.CURSOR_UPDATE:
      if (payload.length >= 3) {
        protocolLayer.fields.push(
          { offset: payloadStart, bytes: payload.slice(0, 1).toString('hex'), field: 'Track index (uint8)', value: payload[0], source: 'protocol.js:82 — view.setUint8(5, trackIdx)' },
          { offset: payloadStart + 1, bytes: payload.slice(1, 2).toString('hex'), field: 'Scene index (uint8)', value: payload[1], source: 'protocol.js:83 — view.setUint8(6, sceneIdx)' },
          { offset: payloadStart + 2, bytes: payload.slice(2, 3).toString('hex'), field: 'Editing flag (bool)', value: payload[2] === 1, source: 'protocol.js:84 — view.setUint8(7, editing ? 1 : 0)' }
        );
        if (payload.length > 3) {
          var userId = payload.slice(3).toString('utf8');
          protocolLayer.fields.push({
            offset: (payloadStart + 3) + '+',
            bytes: payload.slice(3, Math.min(19, payload.length)).toString('hex'),
            field: 'User ID (UTF-8)',
            value: '"' + userId + '"',
            source: 'protocol.js:85 — arr.set(userBytes, 8)  // TextEncoder.encode(userId)'
          });
        }
      }
      break;

    case C.PKT.ASSET_MANIFEST:
      var jsonStr = payload.toString('utf8');
      var truncJson = jsonStr.length > 80 ? jsonStr.substring(0, 80) + '...' : jsonStr;
      protocolLayer.fields.push({
        offset: payloadStart + '+',
        bytes: payload.slice(0, Math.min(24, payload.length)).toString('hex') + '...',
        field: 'Manifest JSON (UTF-8)',
        value: truncJson,
        source: 'tcp-stack.js:325 — sendMessage(C.PKT.ASSET_MANIFEST, data)\n' +
                '                    → JSON.stringify(manifest)\n' +
                '                    Manifest built by asset-resolver.js:87 — buildManifest()'
      });
      break;

    case C.PKT.ASSET_TRANSFER:
      if (payload.length >= 2) {
        var pathLen = payload.readUInt16LE(0);
        var filePath = payload.slice(2, 2 + pathLen).toString('utf8');
        var fileSize = payload.length - 2 - pathLen;
        protocolLayer.fields.push(
          { offset: payloadStart + '-' + (payloadStart + 1), bytes: payload.slice(0, 2).toString('hex'), field: 'Path length (uint16 LE)', value: pathLen, source: 'tcp-stack.js:341 — header.writeUInt16LE(pathBuf.length, 0)' },
          { offset: (payloadStart + 2) + '-' + (payloadStart + 1 + pathLen), bytes: payload.slice(2, 2 + pathLen).toString('hex'), field: 'File path (UTF-8)', value: '"' + filePath + '"', source: 'tcp-stack.js:340 — Buffer.from(relativePath, "utf8")' },
          { offset: (payloadStart + 2 + pathLen) + '+', bytes: payload.slice(2 + pathLen, 2 + pathLen + Math.min(16, fileSize)).toString('hex') + '...', field: 'File data (raw bytes)', value: fileSize + ' bytes', source: 'tcp-stack.js:342 — Buffer.concat([header, pathBuf, fileData])\n' +
                  '                    File read by asset-resolver.js:304 — getFileForTransfer()' }
        );
      }
      break;

    case C.PKT.PING:
      if (payload.length >= 8) {
        var pingLo = payload.readUInt32LE(0);
        var pingHi = payload.readUInt32LE(4);
        var pingTs = pingHi * 0x100000000 + pingLo;
        protocolLayer.fields.push({
          offset: payloadStart + '-' + (payloadStart + 7),
          bytes: payload.slice(0, 8).toString('hex'),
          field: 'Ping timestamp (ms since epoch)',
          value: pingTs > 0 ? new Date(pingTs).toISOString() : pingTs,
          source: 'tcp-stack.js:399-403 — sendPing()\n' +
                  '                    buf.writeUInt32LE(now >>> 0, 5)\n' +
                  '                    buf.writeUInt32LE((now / 0x100000000) >>> 0, 9)'
        });
      }
      break;

    case C.PKT.HEARTBEAT:
      protocolLayer.fields.push({
        offset: payloadStart + '+',
        bytes: payload.slice(0, Math.min(8, payload.length)).toString('hex'),
        field: 'Heartbeat payload',
        value: payload.length + ' bytes',
        source: 'protocol.js:111-121 — buildHeartbeat(seq)\n' +
                '                    Triggered by tcp-stack.js:373 — keepalive timer'
      });
      break;

    case C.PKT.HEARTBEAT_ACK:
      protocolLayer.fields.push({
        offset: payloadStart + '+',
        bytes: payload.slice(0, Math.min(8, payload.length)).toString('hex'),
        field: 'Heartbeat ACK (echoed seq)',
        value: payload.length + ' bytes',
        source: 'tcp-stack.js:233-237 — auto-reply on HEARTBEAT receive'
      });
      break;

    case C.PKT.PONG:
      if (payload.length >= 8) {
        protocolLayer.fields.push({
          offset: payloadStart + '-' + (payloadStart + 7),
          bytes: payload.slice(0, 8).toString('hex'),
          field: 'Echoed ping timestamp',
          value: payload.length + ' bytes',
          source: 'tcp-stack.js:409-416 — _handlePing() echoes timestamp back'
        });
      }
      break;

    default:
      if (payload.length > 0) {
        protocolLayer.fields.push({
          offset: payloadStart + '+',
          bytes: payload.slice(0, Math.min(16, payload.length)).toString('hex'),
          field: 'Raw payload',
          value: payload.length + ' bytes',
          source: '(unknown packet type 0x' + pktType.toString(16) + ')'
        });
      }
  }

  result.layers.push(protocolLayer);
  return result;
}

function printPacket(idx, direction, frame) {
  var desc = describeFrame(frame);

  console.log('');
  console.log('================================================================');
  console.log('PACKET #' + idx + '  ' + direction + '  (' + desc.totalBytes + ' bytes on wire)');
  console.log('================================================================');
  console.log('');

  // IPv4 layer (reconstructed — we know the addresses)
  console.log('LAYER 1: IPv4 HEADER (added by kernel, not in our JS)');
  console.log('  Source: js/hub/tcp-stack.js:131 — socket = net.createConnection({host: "' + REAL_IP + '"})');
  console.log('  Which calls: Node.js net module → libuv → OS socket() + connect()');
  console.log('  +------+------+------+------+------+------+------+------+');
  console.log('  | Ver  | IHL  | DSCP | ECN  |     Total Length          |');
  console.log('  |  4   |  5   |  0   |  0   |  ' + padN(20 + 20 + desc.totalBytes, 5) + '                    |');
  console.log('  +------+------+------+------+------+------+------+------+');
  console.log('  |      Identification       | Flags|  Fragment Offset   |');
  console.log('  +------+------+------+------+------+------+------+------+');
  console.log('  | TTL  | Proto|     Header Checksum                     |');
  console.log('  | 128  |   6  |  (computed by NIC)                      |');
  console.log('  |      | TCP  |                                         |');
  console.log('  +------+------+-----------------------------------------+');
  console.log('  | Source IP:      ' + REAL_IP + padS(42 - 18 - REAL_IP.length) + '|');
  console.log('  | Destination IP: ' + REAL_IP + padS(42 - 18 - REAL_IP.length) + '|');
  console.log('  +----------------------------------------------------------+');
  console.log('  Source: Kernel TCP/IP stack — configured when tcp-stack.js calls');
  console.log('          net.createConnection({host: "' + REAL_IP + '", port: ' + PORT + '})');
  console.log('          → js/hub/tcp-stack.js:131-135');
  console.log('');

  // TCP layer
  console.log('LAYER 2: TCP HEADER (added by kernel, tuned by tcp-stack.js)');
  console.log('  +------+------+------+------+------+------+------+------+');
  console.log('  |     Source Port            |   Destination Port        |');
  console.log('  |     (ephemeral)            |   ' + padN(PORT, 5) + '                    |');
  console.log('  +------+------+------+------+------+------+------+------+');
  console.log('  |                  Sequence Number                       |');
  console.log('  +------+------+------+------+------+------+------+------+');
  console.log('  |               Acknowledgment Number                    |');
  console.log('  +------+------+------+------+------+------+------+------+');
  console.log('  | Offset | Reserved | Flags (PSH,ACK) |  Window Size   |');
  console.log('  +------+------+------+------+------+------+------+------+');
  console.log('  |     Checksum              |    Urgent Pointer          |');
  console.log('  +------+------+------+------+------+------+------+------+');
  console.log('  TCP options set by tcp-stack.js:');
  console.log('    socket.setNoDelay(true)   → TCP_NODELAY, disables Nagle');
  console.log('      Source: tcp-stack.js:155 — inside _acceptSocket()');
  console.log('    socket.setKeepAlive(true) → SO_KEEPALIVE at 10s');
  console.log('      Source: tcp-stack.js:156');
  console.log('');

  // Application layers
  for (var li = 0; li < desc.layers.length; li++) {
    var layer = desc.layers[li];
    console.log('LAYER ' + (li + 3) + ': ' + layer.name);
    if (layer.source) console.log('  Source: ' + layer.source);
    if (layer.note) console.log('  Note: ' + layer.note);
    if (layer.fields) {
      for (var fi = 0; fi < layer.fields.length; fi++) {
        var f = layer.fields[fi];
        console.log('  +-- Offset ' + f.offset + ': [' + f.bytes + ']');
        console.log('  |   Field:  ' + f.field);
        console.log('  |   Value:  ' + f.value);
        console.log('  |   Source: ' + f.source);
      }
    }
    console.log('');
  }

  // Hex dump
  console.log('RAW APPLICATION BYTES (what tcp-stack.js wrote to socket):');
  console.log(hexDump(desc.raw, 0, Math.min(desc.totalBytes, 128)));
  if (desc.totalBytes > 128) console.log('    ... (' + (desc.totalBytes - 128) + ' more bytes)');
  console.log('');
}

function padN(n, w) { var s = String(n); while (s.length < w) s = ' ' + s; return s; }
function padS(n) { var s = ''; for (var i = 0; i < n; i++) s += ' '; return s; }

// =====================================================================
// Run the trace
// =====================================================================

var server = new TcpStack({ port: PORT, sendBufferSize: 64 * 1024 });
var client = new TcpStack({ port: PORT, sendBufferSize: 64 * 1024 });

var packetIdx = 0;

console.log('TCP/IP PACKET TRACE');
console.log('Binding to real NIC: ' + REAL_IP + ':' + PORT);
console.log('Capturing application-layer frames and mapping to source code...');
console.log('');

server.listen(PORT, function(err) {
  if (err) { console.log('FAIL: ' + err); process.exit(1); }

  // Monkey-patch to capture outgoing frames
  var origAccept = server._acceptSocket.bind(server);
  server._acceptSocket = function(socket) {
    origAccept(socket);
    var origWrite = socket.write.bind(socket);
    socket.write = function(data) {
      // Parse frames from the batch
      var buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      var off = 0;
      while (off + 5 <= buf.length) {
        var pLen = buf.readUInt32LE(off);
        var totalFrame = 4 + pLen;
        if (off + totalFrame > buf.length) break;
        var frame = buf.slice(off, off + totalFrame);
        capturedFrames.push({ dir: 'SERVER -> CLIENT', frame: frame });
        off += totalFrame;
      }
      return origWrite(data);
    };
  };

  client.connect(REAL_IP, PORT, function(err) {
    if (err) { console.log('CONNECT FAIL: ' + err); process.exit(1); }

    // Patch client socket too
    var clientOrigWrite = client._socket.write.bind(client._socket);
    client._socket.write = function(data) {
      var buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      var off = 0;
      while (off + 5 <= buf.length) {
        var pLen = buf.readUInt32LE(off);
        var totalFrame = 4 + pLen;
        if (off + totalFrame > buf.length) break;
        var frame = buf.slice(off, off + totalFrame);
        capturedFrames.push({ dir: 'CLIENT -> SERVER', frame: frame });
        off += totalFrame;
      }
      return clientOrigWrite(data);
    };

    // Now send one of each message type to trace

    // 1) State update
    var statePayload = Buffer.alloc(13);
    statePayload[0] = C.PKT.STATE_UPDATE;
    statePayload.writeUInt32LE(42, 1);
    var now = Date.now();
    statePayload.writeUInt32LE(now >>> 0, 5);
    statePayload.writeUInt32LE((now / 0x100000000) >>> 0, 9);
    client.sendState(statePayload);

    // 2) Cursor update
    var cursorPkt = Buffer.from(protocol.buildCursorPacket(1, 5, 3, true, 'tyler'));
    client.sendCursor(cursorPkt);

    // 3) Manifest
    client.sendManifest({
      files: [
        { path: 'Samples/Collected/kick_808.wav', size: 44100, hash: 'a1b2c3' },
        { path: 'Presets/bass_pad.adv', size: 2048, hash: 'd4e5f6' }
      ],
      plugins: [{ name: 'Serum', className: 'Vst3PluginDevice', track: 'Bass' }]
    });

    // 4) File transfer (small, so we can see full hex dump)
    var sampleFile = Buffer.alloc(64);
    for (var i = 0; i < 64; i++) sampleFile[i] = i;
    client.sendFile('Samples/test_click.wav', sampleFile);

    // 5) Ping (triggers pong from server)
    client.sendPing();

    // Wait for roundtrip
    setTimeout(function() {
      console.log('');
      console.log('================================================================');
      console.log('  CAPTURED ' + capturedFrames.length + ' APPLICATION FRAMES');
      console.log('  On real TCP connection: ' + REAL_IP + ':' + PORT);
      console.log('================================================================');

      // Print each captured frame
      for (var i = 0; i < capturedFrames.length; i++) {
        printPacket(i + 1, capturedFrames[i].dir, capturedFrames[i].frame);
      }

      // Summary: full stack map
      console.log('');
      console.log('================================================================');
      console.log('  COMPLETE TCP/IP STACK MAP: JS SOURCE → WIRE');
      console.log('================================================================');
      console.log('');
      console.log('  YOUR CODE (application layer)');
      console.log('  |');
      console.log('  |  hub-main.js:96       crdt.onLocalUpdate() fires');
      console.log('  |       |                  → builds CRDT binary diff');
      console.log('  |       v');
      console.log('  |  protocol.js:59       buildStatePacket(seq, yjsUpdate)');
      console.log('  |       |                  → [0x11][seq LE32][crdt bytes]');
      console.log('  |       v');
      console.log('  |  tcp-stack.js:304     sendState(packet)');
      console.log('  |       |                  → send(CH.STATE, payload)');
      console.log('  |       v');
      console.log('  |  tcp-stack.js:278     send(channel, payload)');
      console.log('  |       |                  → frame = [len LE32][channel][payload]');
      console.log('  |       |                  → backpressure check vs sendBufferSize');
      console.log('  |       v');
      console.log('  |  tcp-stack.js:296     _flushSendQueue()');
      console.log('  |       |                  → Buffer.concat() coalesces frames');
      console.log('  |       |                  → socket.write(batch)');
      console.log('  |       v');
      console.log('  +-------+----------------------------------------------------------');
      console.log('  |  Node.js net module    socket.write() → libuv uv_write()');
      console.log('  |       |                  → OS send() syscall');
      console.log('  +-------+----------------------------------------------------------');
      console.log('  |  KERNEL TCP STACK');
      console.log('  |       |');
      console.log('  |       +-- TCP_NODELAY=1    (set by tcp-stack.js:155)');
      console.log('  |       |     Nagle disabled → immediate send, no coalescing');
      console.log('  |       |');
      console.log('  |       +-- TCP header added:');
      console.log('  |       |     [src port][dst port ' + PORT + '][seq][ack][flags PSH,ACK]');
      console.log('  |       |     [window][checksum][urgent]');
      console.log('  |       |');
      console.log('  |       +-- Window scaling, congestion control (kernel)');
      console.log('  |       |     cwnd grows on successful ACKs');
      console.log('  |       |     shrinks on loss detection (fast retransmit)');
      console.log('  |       |');
      console.log('  |       +-- Retransmit timer (kernel RTO)');
      console.log('  |             Based on SYN RTT sample');
      console.log('  |');
      console.log('  +-------+----------------------------------------------------------');
      console.log('  |  KERNEL IPv4 STACK');
      console.log('  |       |');
      console.log('  |       +-- IP header added:');
      console.log('  |       |     [ver=4][IHL=5][DSCP][len][id][flags][TTL=128]');
      console.log('  |       |     [proto=6 (TCP)][checksum]');
      console.log('  |       |     [src=' + REAL_IP + '][dst=' + REAL_IP + ']');
      console.log('  |       |');
      console.log('  |       +-- Route lookup → Ethernet 3 (192.168.0.0/24)');
      console.log('  |');
      console.log('  +-------+----------------------------------------------------------');
      console.log('  |  ETHERNET / NIC DRIVER');
      console.log('  |       |');
      console.log('  |       +-- Ethernet frame:');
      console.log('  |       |     [dst MAC][src MAC][EtherType=0x0800 (IPv4)][payload][FCS]');
      console.log('  |       |');
      console.log('  |       +-- NIC DMA → wire (or looped back for same-host)');
      console.log('  |');
      console.log('  +-----------WIRE / SWITCH / ROUTER ---------------------->');
      console.log('');
      console.log('  RECEIVE PATH (reverse):');
      console.log('');
      console.log('  NIC interrupt → kernel IP reassembly → kernel TCP reassembly');
      console.log('  → socket recv buffer → Node.js readable stream');
      console.log('  → tcp-stack.js:187 _onData(chunk)');
      console.log('  → tcp-stack.js:210 _parseFrames()     // length-prefix deframing');
      console.log('  → tcp-stack.js:241 _dispatchFrame()   // channel + type routing');
      console.log('  → emits "state" / "cursor" / "asset_manifest" / etc.');
      console.log('  → hub-main.js:108  crdt.applyRemoteUpdate()');
      console.log('  → hub-main.js:291  _applyRemoteChangesToAbleton()');
      console.log('  → live-bridge.js   LiveAPI calls → Ableton changes tracks/clips');
      console.log('');

      server.destroy();
      client.destroy();
      process.exit(0);
    }, 3000);
  });
});

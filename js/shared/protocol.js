// coLaB packet protocol - binary format builders and parsers
var C = require('./constants');

// --- Packet Header ---
// [1 byte: type] [4 bytes: sequence] [variable: payload]

exports.buildHeader = function(type, seq) {
  var buf = new ArrayBuffer(5);
  var view = new DataView(buf);
  view.setUint8(0, type);
  view.setUint32(1, seq, true); // little-endian
  return new Uint8Array(buf);
};

exports.parseHeader = function(data) {
  var view = new DataView(data.buffer || data);
  return {
    type: view.getUint8(0),
    seq: view.getUint32(1, true)
  };
};

// --- Audio Packet ---
// [header: 5 bytes] [4 bytes: timestamp] [2 bytes: trackId] [2 bytes: payloadLen] [N bytes: opus data]

exports.buildAudioPacket = function(seq, timestamp, trackId, opusData) {
  var headerLen = 5 + 4 + 2 + 2; // header + ts + trackId + payloadLen
  var buf = new ArrayBuffer(headerLen + opusData.length);
  var view = new DataView(buf);
  var arr = new Uint8Array(buf);

  // header
  view.setUint8(0, C.PKT.AUDIO_DATA);
  view.setUint32(1, seq, true);
  // audio fields
  view.setUint32(5, timestamp, true);
  view.setUint16(9, trackId, true);
  view.setUint16(11, opusData.length, true);
  // payload
  arr.set(opusData, headerLen);

  return arr;
};

exports.parseAudioPacket = function(data) {
  var view = new DataView(data.buffer || data);
  var payloadLen = view.getUint16(11, true);
  return {
    seq: view.getUint32(1, true),
    timestamp: view.getUint32(5, true),
    trackId: view.getUint16(9, true),
    payload: new Uint8Array(data.buffer || data, 13, payloadLen)
  };
};

// --- State Update Packet ---
// [header: 5 bytes] [N bytes: Yjs update binary]

exports.buildStatePacket = function(seq, yjsUpdate) {
  var buf = new ArrayBuffer(5 + yjsUpdate.length);
  var arr = new Uint8Array(buf);
  var view = new DataView(buf);

  view.setUint8(0, C.PKT.STATE_UPDATE);
  view.setUint32(1, seq, true);
  arr.set(yjsUpdate, 5);

  return arr;
};

exports.parseStatePacket = function(data) {
  return {
    seq: new DataView(data.buffer || data).getUint32(1, true),
    update: new Uint8Array(data.buffer || data, 5)
  };
};

// --- Cursor Update Packet ---
// [header: 5 bytes] [1 byte: trackIdx] [1 byte: sceneIdx] [1 byte: editing flag] [N bytes: userId UTF8]

exports.buildCursorPacket = function(seq, trackIdx, sceneIdx, editing, userId) {
  var userBytes = new TextEncoder().encode(userId);
  var buf = new ArrayBuffer(5 + 3 + userBytes.length);
  var arr = new Uint8Array(buf);
  var view = new DataView(buf);

  view.setUint8(0, C.PKT.CURSOR_UPDATE);
  view.setUint32(1, seq, true);
  view.setUint8(5, trackIdx);
  view.setUint8(6, sceneIdx);
  view.setUint8(7, editing ? 1 : 0);
  arr.set(userBytes, 8);

  return arr;
};

exports.parseCursorPacket = function(data) {
  var view = new DataView(data.buffer || data);
  return {
    seq: view.getUint32(1, true),
    trackIdx: view.getUint8(5),
    sceneIdx: view.getUint8(6),
    editing: view.getUint8(7) === 1,
    userId: new TextDecoder().decode(new Uint8Array(data.buffer || data, 8))
  };
};

// --- Heartbeat ---
// [header: 5 bytes] [8 bytes: timestamp ms]

exports.buildHeartbeat = function(seq) {
  var buf = new ArrayBuffer(5 + 8);
  var view = new DataView(buf);
  view.setUint8(0, C.PKT.HEARTBEAT);
  view.setUint32(1, seq, true);
  // timestamp as two 32-bit values (JS doesn't have native 64-bit int)
  var now = Date.now();
  view.setUint32(5, (now / 0x100000000) >>> 0, true);
  view.setUint32(9, now >>> 0, true);
  return new Uint8Array(buf);
};

// --- Discovery Beacon ---
// [header: 5 bytes] [N bytes: JSON {userName, sessionId, trackCount}]

exports.buildDiscoveryBeacon = function(seq, info) {
  var json = JSON.stringify(info);
  var jsonBytes = new TextEncoder().encode(json);
  var buf = new ArrayBuffer(5 + jsonBytes.length);
  var arr = new Uint8Array(buf);
  var view = new DataView(buf);

  view.setUint8(0, C.PKT.DISCOVERY_BEACON);
  view.setUint32(1, seq, true);
  arr.set(jsonBytes, 5);

  return arr;
};

exports.parseDiscoveryBeacon = function(data) {
  var json = new TextDecoder().decode(new Uint8Array(data.buffer || data, 5));
  return {
    seq: new DataView(data.buffer || data).getUint32(1, true),
    info: JSON.parse(json)
  };
};

/**
 * coLaB Sync v9.0 — AbletonOSC Edition
 * Runs INSIDE Max for Live via [node.script] — full Node.js runtime.
 * Uses AbletonOSC (UDP 11000/11001) for ALL Ableton communication.
 * Zero TCP. Zero AbletonBridge dependency.
 *
 * Patcher: [node.script colab-sync-node.js @autowatch 1]
 *          [node.debug 9229]
 *
 * Requires: AbletonOSC Remote Script active in Ableton.
 */

var dgram = require('dgram');
var maxAPI = require('max-api');

// =========================================================================
// CONFIG
// =========================================================================

var PEER = '192.168.0.83';
var UDP_PORT = 8001;          // peer delta exchange
var OSC_SEND_PORT = 11000;    // AbletonOSC command input
var OSC_RECV_PORT = 11001;    // AbletonOSC response output
var UID = 'u' + Math.random().toString(36).substr(2, 6);
var VERSION = '9.0';

var ECHO_MIXER_MS = 800;
var ECHO_DEVICE_MS = 1500;
var ECHO_TRANSPORT_MS = 1000;

var MIXER_POLL_MS = 60;
var DEVICE_POLL_MS = 200;
var TRANSPORT_POLL_MS = 200;

// =========================================================================
// OSC ENCODE / DECODE (inline, zero deps)
// =========================================================================

function oscPad(len) { return (4 - (len % 4)) % 4; }

function oscEncodeString(str) {
  var b = Buffer.from(str + '\0', 'utf8');
  var pad = oscPad(b.length);
  return pad > 0 ? Buffer.concat([b, Buffer.alloc(pad)]) : b;
}

function oscEncodeInt(val) {
  var b = Buffer.alloc(4);
  b.writeInt32BE(val, 0);
  return b;
}

function oscEncodeFloat(val) {
  var b = Buffer.alloc(4);
  b.writeFloatBE(val, 0);
  return b;
}

function oscEncode(address, args) {
  var typeTags = ',';
  var argBuffers = [];

  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a.type === 'i') {
      typeTags += 'i';
      argBuffers.push(oscEncodeInt(a.value));
    } else if (a.type === 'f') {
      typeTags += 'f';
      argBuffers.push(oscEncodeFloat(a.value));
    } else if (a.type === 's') {
      typeTags += 's';
      argBuffers.push(oscEncodeString(a.value));
    }
  }

  return Buffer.concat([
    oscEncodeString(address),
    oscEncodeString(typeTags)
  ].concat(argBuffers));
}

function oscDecodeString(buf, offset) {
  var end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  var str = buf.toString('utf8', offset, end);
  end++; // skip null
  end += oscPad(end - offset + (4 - oscPad(end - offset)) === 4 ? 0 : 0);
  // realign to 4-byte boundary from the start of this string field
  var consumed = end - offset;
  var padded = consumed + oscPad(consumed);
  return { value: str, offset: offset + padded };
}

function oscDecode(buf) {
  if (buf.length < 4) return null;
  var r = oscDecodeString(buf, 0);
  var address = r.value;
  var offset = r.offset;

  if (offset >= buf.length) return { address: address, args: [] };
  r = oscDecodeString(buf, offset);
  var typeTags = r.value;
  offset = r.offset;

  var args = [];
  // skip leading ','
  for (var i = 1; i < typeTags.length; i++) {
    var tag = typeTags[i];
    if (tag === 'i') {
      args.push({ type: 'i', value: buf.readInt32BE(offset) });
      offset += 4;
    } else if (tag === 'f') {
      args.push({ type: 'f', value: buf.readFloatBE(offset) });
      offset += 4;
    } else if (tag === 's') {
      r = oscDecodeString(buf, offset);
      args.push({ type: 's', value: r.value });
      offset = r.offset;
    }
  }
  return { address: address, args: args };
}

// =========================================================================
// OSC TRANSPORT — send commands, receive responses
// =========================================================================

var oscSock = dgram.createSocket('udp4');
var responseHandlers = {};    // address -> [callback, ...]

function oscSend(address, args) {
  var buf = oscEncode(address, args || []);
  oscSock.send(buf, 0, buf.length, OSC_SEND_PORT, '127.0.0.1');
}

function oscQuery(address, args, cb) {
  oscSend(address, args || []);
  if (!responseHandlers[address]) responseHandlers[address] = [];
  responseHandlers[address].push(cb);
}

oscSock.on('message', function(msg) {
  var pkt = oscDecode(msg);
  if (!pkt) return;
  var handlers = responseHandlers[pkt.address];
  if (handlers && handlers.length > 0) {
    var cb = handlers.shift();
    if (handlers.length === 0) delete responseHandlers[pkt.address];
    cb(pkt.args);
  }
});

oscSock.on('error', function(err) {
  maxAPI.post('OSC socket error: ' + err.message);
});

// =========================================================================
// STATE
// =========================================================================

var ready = false;
var TRACK_COUNT = 0;
var RETURN_COUNT = 0;
var mixSnap = [];         // [{vol,pan,mute,solo,arm}]
var devSnap = {};         // 'ti:di' -> [float, ...]
var transportSnap = { tempo: 120, playing: 0 };
var echoLock = {};
var deltaSent = 0;
var deltaRecv = 0;

var devPollIdx = 0;
var DEVICE_MAP = [];      // [{track, device, params}]

// =========================================================================
// PEER UDP (send/receive deltas to partner)
// =========================================================================

var peerUDP = dgram.createSocket('udp4');

peerUDP.on('message', function(msg) {
  try {
    var d = JSON.parse(msg.toString());
    if (d.u === UID) return;
    deltaRecv++;
    applyDelta(d);
  } catch(e) {}
});

function peerSend(data) {
  data.u = UID;
  var msg = Buffer.from(JSON.stringify(data));
  peerUDP.send(msg, 0, msg.length, UDP_PORT, PEER);
  deltaSent++;
}

// =========================================================================
// ECHO GUARD
// =========================================================================

function lock(key, ms) { echoLock[key] = Date.now() + (ms || 1000); }
function locked(key) {
  var u = echoLock[key];
  if (!u) return false;
  if (Date.now() >= u) { delete echoLock[key]; return false; }
  return true;
}

setInterval(function() {
  var now = Date.now();
  var keys = Object.keys(echoLock);
  for (var i = 0; i < keys.length; i++) {
    if (echoLock[keys[i]] < now) delete echoLock[keys[i]];
  }
}, 10000);

// =========================================================================
// DISCOVERY — count tracks, returns, devices
// =========================================================================

function discover() {
  maxAPI.post('coLaB Sync v' + VERSION + ' discovering session...');

  oscQuery('/live/song/get/num_tracks', [], function(args) {
    TRACK_COUNT = (args[0] && args[0].value) || 0;
    maxAPI.post('Tracks: ' + TRACK_COUNT);

    oscQuery('/live/song/get/num_return_tracks', [], function(args2) {
      RETURN_COUNT = (args2[0] && args2[0].value) || 0;
      maxAPI.post('Returns: ' + RETURN_COUNT);

      oscQuery('/live/song/get/tempo', [], function(args3) {
        transportSnap.tempo = (args3[0] && args3[0].value) || 120;
        maxAPI.post('Tempo: ' + transportSnap.tempo);

        // Snapshot initial mixer state for all tracks
        initMixerSnap(0, function() {
          // Discover devices on tracks
          discoverDevices(0, function() {
            maxAPI.post('Ready: ' + TRACK_COUNT + ' tracks, ' +
                        RETURN_COUNT + ' returns, ' +
                        DEVICE_MAP.length + ' devices');
            ready = true;
            startPolling();
          });
        });
      });
    });
  });
}

function initMixerSnap(idx, done) {
  if (idx >= TRACK_COUNT) { done(); return; }
  var pending = 3;
  var snap = { vol: 0, pan: 0, mute: 0, solo: 0, arm: 0 };

  function check() { if (--pending === 0) { mixSnap[idx] = snap; initMixerSnap(idx + 1, done); } }

  oscQuery('/live/track/get/volume', [{ type: 'i', value: idx }], function(a) {
    snap.vol = (a[1] && a[1].value) || 0; check();
  });
  oscQuery('/live/track/get/panning', [{ type: 'i', value: idx }], function(a) {
    snap.pan = (a[1] && a[1].value) || 0; check();
  });
  oscQuery('/live/track/get/mute', [{ type: 'i', value: idx }], function(a) {
    snap.mute = (a[1] && a[1].value) || 0;
    // piggyback solo + arm
    oscQuery('/live/track/get/solo', [{ type: 'i', value: idx }], function(b) {
      snap.solo = (b[1] && b[1].value) || 0;
      oscQuery('/live/track/get/arm', [{ type: 'i', value: idx }], function(c) {
        snap.arm = (c[1] && c[1].value) || 0;
        check();
      });
    });
  });
}

function discoverDevices(trackIdx, done) {
  if (trackIdx >= TRACK_COUNT) { done(); return; }
  oscQuery('/live/device/get/num_parameters', [
    { type: 'i', value: trackIdx },
    { type: 'i', value: 0 }
  ], function(args) {
    var paramCount = (args[0] && args[0].value) || 0;
    if (paramCount > 0) {
      DEVICE_MAP.push({ track: trackIdx, device: 0, params: paramCount });
    }
    discoverDevices(trackIdx + 1, done);
  });
}

// =========================================================================
// POLLING
// =========================================================================

var mixerTimer, deviceTimer, transportTimer;

function startPolling() {
  mixerTimer = setInterval(pollMixer, MIXER_POLL_MS);
  deviceTimer = setInterval(pollDevice, DEVICE_POLL_MS);
  transportTimer = setInterval(pollTransport, TRANSPORT_POLL_MS);
  maxAPI.post('Polling started (mixer:' + MIXER_POLL_MS +
              'ms, dev:' + DEVICE_POLL_MS +
              'ms, transport:' + TRANSPORT_POLL_MS + 'ms)');
}

// --- Mixer Polling ---
// Queries one track per tick in round-robin to avoid flooding OSC
var mixPollIdx = 0;

function pollMixer() {
  if (!ready) return;
  var idx = mixPollIdx % TRACK_COUNT;
  mixPollIdx++;
  if (locked('m:' + idx)) return;

  var snap = mixSnap[idx];
  if (!snap) return;

  oscQuery('/live/track/get/volume', [{ type: 'i', value: idx }], function(a) {
    var val = (a[1] && a[1].value) || 0;
    if (Math.abs(val - snap.vol) > 0.001) { snap.vol = val; peerSend({ t: 'mx', i: idx, p: 'vol', v: val }); }
  });
  oscQuery('/live/track/get/panning', [{ type: 'i', value: idx }], function(a) {
    var val = (a[1] && a[1].value) || 0;
    if (Math.abs(val - snap.pan) > 0.001) { snap.pan = val; peerSend({ t: 'mx', i: idx, p: 'pan', v: val }); }
  });
  oscQuery('/live/track/get/mute', [{ type: 'i', value: idx }], function(a) {
    var val = (a[1] && a[1].value) || 0;
    if (val !== snap.mute) { snap.mute = val; peerSend({ t: 'mx', i: idx, p: 'mute', v: val }); }
  });
  oscQuery('/live/track/get/solo', [{ type: 'i', value: idx }], function(a) {
    var val = (a[1] && a[1].value) || 0;
    if (val !== snap.solo) { snap.solo = val; peerSend({ t: 'mx', i: idx, p: 'solo', v: val }); }
  });
  oscQuery('/live/track/get/arm', [{ type: 'i', value: idx }], function(a) {
    var val = (a[1] && a[1].value) || 0;
    if (val !== snap.arm) { snap.arm = val; peerSend({ t: 'mx', i: idx, p: 'arm', v: val }); }
  });
}

// --- Device Param Polling ---
// Rotates 1 device per tick

function pollDevice() {
  if (!ready || DEVICE_MAP.length === 0) return;
  var dm = DEVICE_MAP[devPollIdx % DEVICE_MAP.length];
  devPollIdx++;
  var key = dm.track + ':' + dm.device;
  if (locked('d:' + key)) return;

  oscQuery('/live/device/get/parameters/value', [
    { type: 'i', value: dm.track },
    { type: 'i', value: dm.device }
  ], function(args) {
    var old = devSnap[key];
    if (!old) {
      devSnap[key] = args.map(function(a) { return a.value; });
      return;
    }
    for (var p = 0; p < args.length; p++) {
      var val = args[p].value;
      if (old[p] !== undefined && Math.abs(val - old[p]) > 0.0001) {
        old[p] = val;
        peerSend({ t: 'dp', ti: dm.track, di: dm.device, pi: p, v: val });
      }
      if (old[p] === undefined) old[p] = val;
    }
  });
}

// --- Transport Polling ---

function pollTransport() {
  if (!ready) return;

  if (!locked('tempo')) {
    oscQuery('/live/song/get/tempo', [], function(args) {
      var val = (args[0] && args[0].value) || 120;
      if (Math.abs(val - transportSnap.tempo) > 0.01) {
        transportSnap.tempo = val;
        peerSend({ t: 'tp', v: val });
      }
    });
  }

  if (!locked('playing')) {
    oscQuery('/live/song/get/is_playing', [], function(args) {
      var val = (args[0] && args[0].value) || 0;
      if (val !== transportSnap.playing) {
        transportSnap.playing = val;
        peerSend({ t: 'pl', v: val });
      }
    });
  }
}

// =========================================================================
// APPLY RECEIVED DELTAS (via AbletonOSC)
// =========================================================================

function applyDelta(d) {
  switch (d.t) {
    case 'mx': applyMixer(d); break;
    case 'dp': applyDevParam(d); break;
    case 'tp': applyTempo(d); break;
    case 'pl': applyPlaying(d); break;
  }
}

function applyMixer(d) {
  lock('m:' + d.i, ECHO_MIXER_MS);
  var idx = d.i;
  var propMap = {
    vol:  '/live/track/set/volume',
    pan:  '/live/track/set/panning',
    mute: '/live/track/set/mute',
    solo: '/live/track/set/solo',
    arm:  '/live/track/set/arm'
  };
  var addr = propMap[d.p];
  if (!addr) return;

  var argType = (d.p === 'vol' || d.p === 'pan') ? 'f' : 'i';
  oscSend(addr, [
    { type: 'i', value: idx },
    { type: argType, value: d.v }
  ]);

  if (mixSnap[idx]) mixSnap[idx][d.p] = d.v;
}

function applyDevParam(d) {
  var key = d.ti + ':' + d.di;
  lock('d:' + key, ECHO_DEVICE_MS);
  oscSend('/live/device/set/parameters/value', [
    { type: 'i', value: d.ti },
    { type: 'i', value: d.di },
    { type: 'i', value: d.pi },
    { type: 'f', value: d.v }
  ]);
  if (devSnap[key]) devSnap[key][d.pi] = d.v;
}

function applyTempo(d) {
  lock('tempo', ECHO_TRANSPORT_MS);
  oscSend('/live/song/set/tempo', [{ type: 'f', value: d.v }]);
  transportSnap.tempo = d.v;
}

function applyPlaying(d) {
  lock('playing', ECHO_TRANSPORT_MS);
  if (d.v) oscSend('/live/song/start_playing', []);
  else oscSend('/live/song/stop_playing', []);
  transportSnap.playing = d.v;
}

// =========================================================================
// MAX HANDLERS (messages from patcher)
// =========================================================================

maxAPI.addHandler('init', function() {
  discover();
});

maxAPI.addHandler('connect', function(ip) {
  PEER = ip || PEER;
  maxAPI.post('Peer set: ' + PEER);
});

maxAPI.addHandler('stats', function() {
  maxAPI.post('[STATS] trk:' + TRACK_COUNT +
              ' dev:' + DEVICE_MAP.length +
              ' sent:' + deltaSent +
              ' recv:' + deltaRecv +
              ' locks:' + Object.keys(echoLock).length +
              ' osc:OK');
});

maxAPI.addHandler('stop', function() {
  ready = false;
  clearInterval(mixerTimer);
  clearInterval(deviceTimer);
  clearInterval(transportTimer);
  maxAPI.post('Sync stopped');
});

maxAPI.addHandler('rescan', function() {
  ready = false;
  clearInterval(mixerTimer);
  clearInterval(deviceTimer);
  clearInterval(transportTimer);
  DEVICE_MAP = [];
  devSnap = {};
  mixSnap = [];
  devPollIdx = 0;
  mixPollIdx = 0;
  discover();
});

// =========================================================================
// BIND SOCKETS + AUTO-INIT
// =========================================================================

oscSock.bind(OSC_RECV_PORT, function() {
  maxAPI.post('OSC response socket bound on ' + OSC_RECV_PORT);
});

peerUDP.bind(UDP_PORT, function() {
  maxAPI.post('Peer UDP bound on ' + UDP_PORT);
  // Auto-init after 2s to let Ableton settle
  setTimeout(discover, 2000);
});

peerUDP.on('error', function(err) {
  maxAPI.post('Peer UDP error: ' + err.message + ' (port ' + UDP_PORT + ' in use?)');
});

maxAPI.post('coLaB Sync v' + VERSION + ' (AbletonOSC) loaded — UID:' + UID);

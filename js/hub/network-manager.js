// coLaB Network Manager
// Abstracts network transport for M4L environment
// Phase 1: UDP via Max [udpsend]/[udpreceive] objects
// Phase 2: WebRTC upgrade path

var C = require('../shared/constants');
var protocol = require('../shared/protocol');

function NetworkManager(maxApi) {
  // maxApi provides access to Max's messaging system
  // In M4L JS, we communicate with [udpsend]/[udpreceive] via Max messages
  this.maxApi = maxApi;
  this._handlers = {};
  this._statePort = C.STATE_PORT;
  this._audioPortBase = C.AUDIO_PORT_BASE;
  this._partnerIp = null;
  this._bound = false;
}

// --- Initialization ---
// In M4L, network I/O is done through Max objects [udpsend] and [udpreceive]
// The JS module sends messages to these objects via the Max patcher

NetworkManager.prototype.bind = function(partnerIp) {
  this._partnerIp = partnerIp;

  // Configure udpsend for state channel
  this._maxSend('udpsend_state', 'host', partnerIp);
  this._maxSend('udpsend_state', 'port', this._statePort);

  // Configure udpreceive to listen on state port
  // (udpreceive port is set in the Max patcher, but we can reconfigure)
  this._maxSend('udpreceive_state', 'port', this._statePort);

  // Configure udpsend for audio channel
  this._maxSend('udpsend_audio', 'host', partnerIp);
  this._maxSend('udpsend_audio', 'port', this._audioPortBase);

  // Configure udpreceive for audio
  this._maxSend('udpreceive_audio', 'port', this._audioPortBase);

  this._bound = true;
};

NetworkManager.prototype.unbind = function() {
  this._partnerIp = null;
  this._bound = false;
};

// --- Send ---

NetworkManager.prototype.sendState = function(packet) {
  if (!this._bound) return;
  // Convert Uint8Array to Max-compatible list of ints
  this._sendBytes('udpsend_state', packet);
};

NetworkManager.prototype.sendAudio = function(packet) {
  if (!this._bound) return;
  this._sendBytes('udpsend_audio', packet);
};

NetworkManager.prototype.sendDiscovery = function(packet) {
  // Send to multicast address
  this._maxSend('udpsend_discovery', 'host', C.MULTICAST_ADDR);
  this._maxSend('udpsend_discovery', 'port', C.DISCOVERY_PORT);
  this._sendBytes('udpsend_discovery', packet);
};

// --- Receive ---
// These are called from Max when [udpreceive] gets data
// The Max patcher routes incoming bytes to our JS via messages

NetworkManager.prototype.handleIncomingState = function(byteList) {
  var data = new Uint8Array(byteList);
  var header = protocol.parseHeader(data);

  switch (header.type) {
    case C.PKT.STATE_UPDATE:
      this._emit('state', data);
      break;
    case C.PKT.CURSOR_UPDATE:
      this._emit('cursor', data);
      break;
    case C.PKT.HEARTBEAT:
      this._emit('heartbeat', data);
      break;
    case C.PKT.HEARTBEAT_ACK:
      this._emit('heartbeat_ack', data);
      break;
    case C.PKT.CONNECT_REQUEST:
      this._emit('connect_request', data);
      break;
    case C.PKT.CONNECT_ACCEPT:
      this._emit('connect_accept', data);
      break;
    case C.PKT.DISCONNECT:
      this._emit('disconnect', data);
      break;
    case C.PKT.DISCOVERY_BEACON:
      this._emit('discovery', data);
      break;
  }
};

NetworkManager.prototype.handleIncomingAudio = function(byteList) {
  var data = new Uint8Array(byteList);
  this._emit('audio', data);
};

// --- Event System ---

NetworkManager.prototype.on = function(event, handler) {
  if (!this._handlers[event]) {
    this._handlers[event] = [];
  }
  this._handlers[event].push(handler);
};

NetworkManager.prototype.off = function(event, handler) {
  if (!this._handlers[event]) return;
  var idx = this._handlers[event].indexOf(handler);
  if (idx !== -1) {
    this._handlers[event].splice(idx, 1);
  }
};

NetworkManager.prototype._emit = function(event, data) {
  var handlers = this._handlers[event];
  if (!handlers) return;
  for (var i = 0; i < handlers.length; i++) {
    handlers[i](data);
  }
};

// --- Max Integration Helpers ---

NetworkManager.prototype._maxSend = function(objectName, msg, value) {
  // In M4L JS, we send messages to named Max objects
  // via the outlet or messnamed function
  if (this.maxApi && this.maxApi.messnamed) {
    this.maxApi.messnamed(objectName, msg, value);
  }
};

NetworkManager.prototype._sendBytes = function(objectName, uint8arr) {
  // Max [udpsend] expects a list of ints
  // We send them as a message: "send <byte0> <byte1> ... <byteN>"
  if (!this.maxApi) return;

  // For large packets, we may need to chunk
  // Max message size limit is ~32KB which is well above our needs
  var args = ['send'];
  for (var i = 0; i < uint8arr.length; i++) {
    args.push(uint8arr[i]);
  }

  if (this.maxApi.messnamed) {
    this.maxApi.messnamed.apply(this.maxApi, [objectName].concat(args));
  }
};

// --- Stats ---

NetworkManager.prototype.getStats = function() {
  return {
    bound: this._bound,
    partnerIp: this._partnerIp,
    statePort: this._statePort,
    audioPort: this._audioPortBase
  };
};

if (typeof module !== 'undefined') {
  module.exports = NetworkManager;
}

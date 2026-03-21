// coLaB Session Manager
// Handles connection lifecycle, discovery, heartbeat, and reconnection

var C = require('../shared/constants');
var protocol = require('../shared/protocol');

function SessionManager(crdt, networkSend) {
  this.crdt = crdt;
  this.networkSend = networkSend; // function(packet, ip, port)
  this.state = 'disconnected'; // disconnected | connecting | connected | reconnecting
  this.partnerIp = null;
  this.partnerName = null;
  this.sessionId = this._generateSessionId();
  this.seq = 0;
  this._heartbeatTimer = null;
  this._heartbeatLastReceived = 0;
  this._reconnectAttempts = 0;
  this._onStateChange = null;
  this._onLatencyUpdate = null;
}

// --- Connection ---

SessionManager.prototype.connect = function(partnerIp) {
  if (this.state === 'connected') {
    this.disconnect();
  }

  this.partnerIp = partnerIp;
  this.state = 'connecting';
  this._notifyStateChange();

  // Send connect request with our state vector
  var stateVector = this.crdt.getStateVector();
  var packet = protocol.buildStatePacket(this._nextSeq(), stateVector);
  // Wrap in connect request
  var connectPkt = new Uint8Array(packet.length + 1);
  connectPkt[0] = C.PKT.CONNECT_REQUEST;
  connectPkt.set(packet.subarray(1), 1); // replace type byte
  // Actually, let's use proper connect packet
  var info = {
    userId: this.crdt.userId,
    sessionId: this.sessionId,
    stateVector: Array.from(stateVector)
  };
  var jsonBytes = new TextEncoder().encode(JSON.stringify(info));
  var buf = new ArrayBuffer(5 + jsonBytes.length);
  var arr = new Uint8Array(buf);
  var view = new DataView(buf);
  view.setUint8(0, C.PKT.CONNECT_REQUEST);
  view.setUint32(1, this._nextSeq(), true);
  arr.set(jsonBytes, 5);

  this.networkSend(arr, partnerIp, C.STATE_PORT);
};

SessionManager.prototype.handleConnectRequest = function(data, fromIp) {
  var json = new TextDecoder().decode(new Uint8Array(data.buffer || data, 5));
  var info = JSON.parse(json);

  this.partnerIp = fromIp;
  this.partnerName = info.userId;

  // Send our full state as response
  var remoteStateVector = new Uint8Array(info.stateVector);
  var missingUpdates = this.crdt.getMissingSince(remoteStateVector);
  var responsePacket = protocol.buildStatePacket(this._nextSeq(), missingUpdates);
  // Change type to CONNECT_ACCEPT
  responsePacket[0] = C.PKT.CONNECT_ACCEPT;
  this.networkSend(responsePacket, fromIp, C.STATE_PORT);

  // Also send our state vector so they can send us what we're missing
  var ourInfo = {
    userId: this.crdt.userId,
    sessionId: this.sessionId,
    stateVector: Array.from(this.crdt.getStateVector())
  };
  // Partner will respond with their missing updates

  this.state = 'connected';
  this._heartbeatLastReceived = Date.now();
  this._startHeartbeat();
  this._notifyStateChange();
};

SessionManager.prototype.handleConnectAccept = function(data) {
  // Apply the state updates from partner
  var parsed = protocol.parseStatePacket(data);
  this.crdt.applyRemoteUpdate(parsed.update);

  this.state = 'connected';
  this._reconnectAttempts = 0;
  this._heartbeatLastReceived = Date.now();
  this._startHeartbeat();
  this._notifyStateChange();
};

SessionManager.prototype.disconnect = function() {
  if (this.partnerIp) {
    var buf = new ArrayBuffer(5);
    var view = new DataView(buf);
    view.setUint8(0, C.PKT.DISCONNECT);
    view.setUint32(1, this._nextSeq(), true);
    this.networkSend(new Uint8Array(buf), this.partnerIp, C.STATE_PORT);
  }

  this._stopHeartbeat();
  this.state = 'disconnected';
  this.partnerIp = null;
  this.partnerName = null;
  this._notifyStateChange();
};

// --- Heartbeat ---

SessionManager.prototype._startHeartbeat = function() {
  this._stopHeartbeat();
  this._heartbeatTimer = setInterval(function() {
    if (this.state !== 'connected' && this.state !== 'reconnecting') return;

    // Send heartbeat
    var pkt = protocol.buildHeartbeat(this._nextSeq());
    this.networkSend(pkt, this.partnerIp, C.STATE_PORT);

    // Check for timeout
    var elapsed = Date.now() - this._heartbeatLastReceived;
    if (elapsed > C.HEARTBEAT_TIMEOUT_MS) {
      this._handleDisconnection();
    }
  }.bind(this), C.HEARTBEAT_INTERVAL_MS);
};

SessionManager.prototype._stopHeartbeat = function() {
  if (this._heartbeatTimer) {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  }
};

SessionManager.prototype.handleHeartbeat = function(data, fromIp) {
  this._heartbeatLastReceived = Date.now();

  // Respond with ack
  var buf = new ArrayBuffer(5);
  var view = new DataView(buf);
  view.setUint8(0, C.PKT.HEARTBEAT_ACK);
  view.setUint32(1, this._nextSeq(), true);
  this.networkSend(new Uint8Array(buf), fromIp, C.STATE_PORT);

  // Calculate latency from timestamp in heartbeat
  if (this._onLatencyUpdate) {
    var hbView = new DataView(data.buffer || data);
    var tsHigh = hbView.getUint32(5, true);
    var tsLow = hbView.getUint32(9, true);
    var sentTime = tsHigh * 0x100000000 + tsLow;
    var latency = Date.now() - sentTime;
    this._onLatencyUpdate(Math.max(0, latency));
  }
};

SessionManager.prototype.handleHeartbeatAck = function() {
  this._heartbeatLastReceived = Date.now();

  // If reconnecting, transition back to connected
  if (this.state === 'reconnecting') {
    this.state = 'connected';
    this._reconnectAttempts = 0;
    this._notifyStateChange();
  }
};

// --- Reconnection ---

SessionManager.prototype._handleDisconnection = function() {
  if (this.state === 'reconnecting') return;

  this.state = 'reconnecting';
  this._notifyStateChange();
  this._attemptReconnect();
};

SessionManager.prototype._attemptReconnect = function() {
  if (this._reconnectAttempts >= C.RECONNECT_MAX_ATTEMPTS) {
    this.state = 'disconnected';
    this._stopHeartbeat();
    this._notifyStateChange();
    return;
  }

  this._reconnectAttempts++;
  // Re-send connect request
  this.connect(this.partnerIp);

  // Schedule retry
  setTimeout(function() {
    if (this.state === 'reconnecting') {
      this._attemptReconnect();
    }
  }.bind(this), C.RECONNECT_DELAY_MS * this._reconnectAttempts);
};

// --- Discovery ---

SessionManager.prototype.broadcastDiscovery = function(userName, trackCount) {
  var pkt = protocol.buildDiscoveryBeacon(this._nextSeq(), {
    userName: userName,
    sessionId: this.sessionId,
    trackCount: trackCount
  });
  this.networkSend(pkt, C.MULTICAST_ADDR, C.DISCOVERY_PORT);
};

// --- Events ---

SessionManager.prototype.onStateChange = function(callback) {
  this._onStateChange = callback;
};

SessionManager.prototype.onLatencyUpdate = function(callback) {
  this._onLatencyUpdate = callback;
};

SessionManager.prototype._notifyStateChange = function() {
  if (this._onStateChange) {
    this._onStateChange(this.state, this.partnerName, this.partnerIp);
  }
};

// --- Utility ---

SessionManager.prototype._nextSeq = function() {
  return this.seq++;
};

SessionManager.prototype._generateSessionId = function() {
  return 'colab-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
};

if (typeof module !== 'undefined') {
  module.exports = SessionManager;
}

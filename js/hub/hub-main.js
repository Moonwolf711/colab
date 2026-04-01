// coLaB Hub - Main Controller
// Entry point for the Hub M4L device
// Wires CRDT engine, Live bridge, network, cursor, and session manager together

var CRDTEngine = require('./crdt-engine');
var LiveBridge = require('./live-bridge');
var NetworkManager = require('./network-manager');
var SessionManager = require('./session-manager');
var CursorTracker = require('./cursor-tracker');
var ActivityLogger = require('./activity-logger');
var RecapGenerator = require('./recap-generator');
var AssetResolver = require('./asset-resolver');
var C = require('../shared/constants');
var protocol = require('../shared/protocol');

// --- M4L JS Globals ---
// In Max for Live JS, these are provided by the runtime:
// - post() for console logging
// - messnamed() for sending to named objects
// - outlet() for sending out of js object outlets

var hub = null;

function Hub() {
  this.userId = 'user-' + Math.random().toString(36).substr(2, 6);
  this.userName = 'Producer';

  // Core modules
  this.liveBridge = new LiveBridge();
  this.crdt = new CRDTEngine(this.userId);
  this.network = new NetworkManager(this);
  this.session = new SessionManager(this.crdt, this._networkSend.bind(this));
  this.cursor = new CursorTracker(this.liveBridge, this.crdt);
  this.activityLogger = new ActivityLogger(this.userId, this.userName);
  this.recapGenerator = new RecapGenerator();
  this.assetResolver = new AssetResolver(this.liveBridge);

  // State
  this._trackMap = {}; // localIndex → crdtId
  this._changePollerTimer = null;
  this._discoveredSessions = [];
  this._lastDisconnectTime = 0;

  this._wireEvents();
}

// --- Initialization ---

Hub.prototype.init = function() {
  post('coLaB Hub initializing...\n');

  // Start activity logging
  var dataDir = null;
  try {
    var path = require('path');
    dataDir = path.join(__dirname, '..', '..', 'data', 'sessions');
  } catch (e) { /* M4L JS — no path module, web-bridge handles persistence */ }
  this.activityLogger.startSession(this.session.sessionId, dataDir);

  // Snapshot current Ableton state into CRDT
  this._syncLocalStateToCRDT();

  // Start polling for local changes
  this._startChangePoller();

  post('coLaB Hub ready. userId=' + this.userId + '\n');
};

// --- Connection API (called from Max UI) ---

Hub.prototype.connect = function(partnerIp) {
  post('coLaB: Connecting to ' + partnerIp + '...\n');
  this.network.bind(partnerIp);
  this.session.connect(partnerIp);
};

Hub.prototype.disconnect = function() {
  post('coLaB: Disconnecting...\n');
  this.cursor.stop();
  this.session.disconnect();
  this.network.unbind();
};

Hub.prototype.setUserName = function(name) {
  this.userName = name;
};

// --- Event Wiring ---

Hub.prototype._wireEvents = function() {
  var self = this;

  // CRDT local updates → network broadcast
  this.crdt.onLocalUpdate(function(update) {
    if (self.session.state === 'connected') {
      var packet = protocol.buildStatePacket(self.session.seq++, update);
      self.network.sendState(packet);
    }
  });

  // CRDT remote changes → apply to Ableton + log activity
  this.crdt.onRemoteChange(function(type, events) {
    self._logRemoteChanges(type, events);
    self._applyRemoteChangesToAbleton(type, events);
  });

  // Network state packets → CRDT
  this.network.on('state', function(data) {
    var parsed = protocol.parseStatePacket(data);
    self.crdt.applyRemoteUpdate(parsed.update);
  });

  // Network connection events → session manager
  this.network.on('connect_request', function(data) {
    self.session.handleConnectRequest(data, self.network._partnerIp);
    self.cursor.start();
  });

  this.network.on('connect_accept', function(data) {
    self.session.handleConnectAccept(data);
    self.cursor.start();
  });

  this.network.on('disconnect', function() {
    self.cursor.stop();
    self.session.disconnect();
  });

  // Heartbeat
  this.network.on('heartbeat', function(data) {
    self.session.handleHeartbeat(data, self.network._partnerIp);
  });

  this.network.on('heartbeat_ack', function() {
    self.session.handleHeartbeatAck();
  });

  // Session state changes → UI update + activity logging
  this.session.onStateChange(function(state, partnerName, partnerIp) {
    self._updateUI('connection', state, partnerName || '', partnerIp || '');

    if (state === 'disconnected' && self._lastDisconnectTime === 0) {
      self._lastDisconnectTime = Date.now();
      self.activityLogger.recordDisconnect();
    } else if (state === 'connected' && self._lastDisconnectTime > 0) {
      // Reconnected — generate recap of what partner did while we were away
      self.activityLogger.recordReconnect();
      var entries = self.activityLogger.getEntriesSince(self._lastDisconnectTime);
      var recap = self.recapGenerator.generate(entries, partnerName);
      self._lastDisconnectTime = 0;
      if (recap.summary && recap.summary.totalChanges > 0) {
        self._deliverRecap(recap);
      }
    }
  });

  // Latency → UI
  this.session.onLatencyUpdate(function(latency) {
    self._updateUI('latency', latency);
  });

  // Audio packets → route to Receive devices
  this.network.on('audio', function(data) {
    var parsed = protocol.parseAudioPacket(data);
    // Route to the correct Receive device based on trackId
    self._routeAudioToReceiver(parsed.trackId, parsed);
  });

  // --- Asset Resolution ---

  // When connected, exchange asset manifests
  this.session.onStateChange(function(state) {
    if (state === 'connected') {
      self._exchangeAssetManifest();
    }
  });

  // Receive partner's asset manifest → resolve missing files
  this.network.on('state', function(data) {
    var header = protocol.parseHeader(data);
    if (header.type === C.PKT.ASSET_MANIFEST) {
      var parsed = protocol.parseAssetManifest(data);
      var result = self.assetResolver.resolveAgainst(parsed.manifest);

      if (result.missing.length > 0 || result.plugins.length > 0) {
        self._alertMissingAssets(result.missing, result.plugins);
      }
    }
  });

  // Missing file alerts from partner
  this.assetResolver.onMissingFiles(function(missingFiles) {
    self.activityLogger._addEntry('asset_missing', 'system', {
      count: missingFiles.length,
      files: missingFiles.map(function(f) { return f.path; })
    });
  });

  this.assetResolver.onMissingPlugins(function(missingPlugins) {
    self.activityLogger._addEntry('plugin_missing', 'system', {
      count: missingPlugins.length,
      plugins: missingPlugins.map(function(p) { return p.name; })
    });
  });
};

// --- Local State Sync (Ableton → CRDT) ---

Hub.prototype._syncLocalStateToCRDT = function() {
  var tracks = this.liveBridge.getTracks();
  this._trackMap = {};

  for (var i = 0; i < tracks.length; i++) {
    var t = tracks[i];
    // Skip return tracks and master
    var trackId = 'track-' + this.userId + '-' + i;
    this._trackMap[i] = trackId;

    this.crdt.addTrack(trackId, {
      name: t.name,
      color: t.color,
      volume: t.volume,
      pan: t.pan,
      mute: t.mute,
      solo: t.solo
    });

    // Add clips
    for (var c = 0; c < t.clipSlots.length; c++) {
      var clip = t.clipSlots[c];
      var clipId = trackId + '-clip-' + clip.slot;
      this.crdt.addClip(trackId, clipId, {
        name: clip.name,
        slot: clip.slot,
        length: clip.length,
        looping: clip.looping,
        notes: clip.notes
      });
    }
  }
};

Hub.prototype._startChangePoller = function() {
  // Poll Ableton for changes at ~10Hz
  // In a production version, we'd use LiveAPI callbacks instead
  this._changePollerTimer = setInterval(function() {
    if (this.liveBridge.isSuppressingEcho()) return;
    this._detectLocalChanges();
  }.bind(this), 100);
};

Hub.prototype._detectLocalChanges = function() {
  // Compare current Ableton state with CRDT state
  // This is a simplified version — production would use LiveAPI observers
  var currentTracks = this.liveBridge.getTracks();

  // Detect new tracks
  for (var i = 0; i < currentTracks.length; i++) {
    if (!this._trackMap[i]) {
      var trackId = 'track-' + this.userId + '-' + i;
      this._trackMap[i] = trackId;
      this.crdt.addTrack(trackId, currentTracks[i]);
    }
  }

  // Detect track parameter changes
  for (var idx in this._trackMap) {
    var crdtId = this._trackMap[idx];
    var crdtTrack = this.crdt.getTrack(crdtId);
    var liveTrack = currentTracks[parseInt(idx)];

    if (!crdtTrack || !liveTrack) continue;

    if (crdtTrack.name !== liveTrack.name) {
      this.activityLogger.logTrackParam('local', crdtId, 'name', crdtTrack.name, liveTrack.name);
      this.crdt.updateTrackParam(crdtId, 'name', liveTrack.name);
    }
    if (Math.abs(crdtTrack.volume - liveTrack.volume) > 0.001) {
      this.activityLogger.logTrackParam('local', crdtId, 'volume', crdtTrack.volume, liveTrack.volume);
      this.crdt.updateTrackParam(crdtId, 'volume', liveTrack.volume);
    }
    if (crdtTrack.mute !== liveTrack.mute) {
      this.activityLogger.logTrackParam('local', crdtId, 'mute', crdtTrack.mute, liveTrack.mute);
      this.crdt.updateTrackParam(crdtId, 'mute', liveTrack.mute);
    }
  }
};

// --- Remote State Sync (CRDT → Ableton) ---

Hub.prototype._applyRemoteChangesToAbleton = function(type, events) {
  if (type !== 'tracks') return;

  // Process Yjs deep events to determine what changed
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    var path = event.path;

    // Top-level track added/removed
    if (path.length === 0 && event.changes) {
      var keys = event.changes.keys;
      if (keys) {
        keys.forEach(function(change, key) {
          if (change.action === 'add') {
            // Remote track added — create in Ableton
            var trackData = this.crdt.getTrack(key);
            if (trackData && trackData.owner !== this.userId) {
              var newIdx = this.liveBridge.createTrack(-1, 'coLaB: ' + trackData.name);
              this._trackMap[newIdx] = key;
            }
          } else if (change.action === 'delete') {
            // Remote track removed — find and delete in Ableton
            for (var idx in this._trackMap) {
              if (this._trackMap[idx] === key) {
                this.liveBridge.deleteTrack(parseInt(idx));
                delete this._trackMap[idx];
                break;
              }
            }
          }
        }.bind(this));
      }
    }
  }
};

// --- Audio Routing ---

Hub.prototype._routeAudioToReceiver = function(trackId, audioData) {
  // Send audio data to the Receive device on the corresponding ghost track
  // This is done via Max messages to named Receive device objects
  this._maxSendAudio('recv_track_' + trackId, audioData.payload);
};

// --- UI Communication ---

Hub.prototype._updateUI = function() {
  // Send state to Max UI objects (jsui, live.text, etc.)
  var args = Array.prototype.slice.call(arguments);
  if (typeof outlet === 'function') {
    outlet.apply(null, [0].concat(args));
  }
};

// --- Max Integration ---

Hub.prototype._networkSend = function(packet, ip, port) {
  this.network._maxSend('udpsend_state', 'host', ip);
  this.network._maxSend('udpsend_state', 'port', port);
  this.network._sendBytes('udpsend_state', packet);
};

Hub.prototype._maxSendAudio = function(receiverName, data) {
  if (typeof messnamed === 'function') {
    var args = [receiverName, 'audio'];
    for (var i = 0; i < data.length; i++) {
      args.push(data[i]);
    }
    messnamed.apply(null, args);
  }
};

// --- Activity Logging ---

Hub.prototype._logRemoteChanges = function(type, events) {
  if (type === 'tracks') {
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var path = event.path;

      // Top-level track added/removed
      if (path.length === 0 && event.changes && event.changes.keys) {
        event.changes.keys.forEach(function(change, key) {
          if (change.action === 'add') {
            var trackData = this.crdt.getTrack(key);
            this.activityLogger.logTrackAdded('partner', key, trackData || {});
          } else if (change.action === 'delete') {
            this.activityLogger.logTrackRemoved('partner', key, change.oldValue ? 'deleted track' : key);
          }
        }.bind(this));
      }

      // Track parameter changes (path = [trackId])
      if (path.length === 1 && event.changes && event.changes.keys) {
        var trackId = path[0];
        event.changes.keys.forEach(function(change, param) {
          if (param === 'clips' || param === 'owner') return;
          this.activityLogger.logTrackParam('partner', trackId, param,
            change.oldValue, this.crdt.tracks.get(trackId) ? this.crdt.tracks.get(trackId).get(param) : null);
        }.bind(this));
      }

      // Clip-level changes (path = [trackId, 'clips'] or deeper)
      if (path.length >= 2 && path[1] === 'clips') {
        var clipTrackId = path[0];
        if (path.length === 2 && event.changes && event.changes.keys) {
          event.changes.keys.forEach(function(change, clipKey) {
            if (change.action === 'add') {
              this.activityLogger.logClipAdded('partner', clipTrackId, clipKey, {
                name: 'New Clip', slot: 0
              });
            } else if (change.action === 'delete') {
              this.activityLogger.logClipRemoved('partner', clipTrackId, clipKey);
            }
          }.bind(this));
        }
      }
    }
  }

  if (type === 'transport') {
    // Transport is a single YMap observe event
    if (events && events.changes && events.changes.keys) {
      events.changes.keys.forEach(function(change, param) {
        this.activityLogger.logTransportChange('partner', param,
          change.oldValue, this.crdt.transport.get(param));
      }.bind(this));
    }
  }
};

Hub.prototype._deliverRecap = function(recap) {
  post('coLaB Session Recap:\n');
  var lines = recap.text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    post('  ' + lines[i] + '\n');
  }

  // Send to Claude Terminal via messnamed (UDP 11002)
  if (typeof messnamed === 'function') {
    for (var j = 0; j < lines.length; j++) {
      if (lines[j].trim()) {
        messnamed('claude_terminal', 'sys', lines[j]);
      }
    }
  }

  // Send to web-bridge via outlet 1 (UDP → port 8003)
  this._updateUI('recap', JSON.stringify(recap));
};

// --- Asset Resolution ---

Hub.prototype._exchangeAssetManifest = function() {
  var manifest = this.assetResolver.buildManifest();
  if (!manifest) {
    post('coLaB: No project path — skip asset manifest exchange\n');
    return;
  }

  post('coLaB: Sending asset manifest (' + manifest.files.length + ' files, ' + manifest.plugins.length + ' plugins)\n');

  // Send manifest to partner via network
  var packet = protocol.buildAssetManifest(this.session.seq++, manifest);
  this.network.sendState(packet);

  // Also forward to web-bridge for UI
  this._updateUI('asset_manifest', JSON.stringify({
    type: 'asset_manifest',
    projectPath: manifest.projectPath,
    manifest: {
      fileCount: manifest.files.length,
      pluginCount: manifest.plugins.length,
      collected: manifest.collected,
      timestamp: manifest.timestamp
    }
  }));
};

Hub.prototype._alertMissingAssets = function(missingFiles, missingPlugins) {
  var fileCount = missingFiles.length;
  var pluginCount = missingPlugins.length;

  post('coLaB: MISSING ASSETS — ' + fileCount + ' files, ' + pluginCount + ' plugins\n');

  // Log details
  for (var i = 0; i < missingFiles.length; i++) {
    var f = missingFiles[i];
    post('  [MISSING] ' + f.path + ' (' + f.reason + ')\n');
  }
  for (var p = 0; p < missingPlugins.length; p++) {
    var pl = missingPlugins[p];
    post('  [PLUGIN] ' + pl.name + ' — ' + pl.reason + ' (track: ' + pl.track + ')\n');
  }

  // Alert Claude Terminal
  if (fileCount > 0) {
    sendToTerminal('[WARN]', fileCount + ' missing sample(s). Run Collect All and Save, or grab from shared zip.');
  }
  if (pluginCount > 0) {
    var names = missingPlugins.map(function(p) { return p.name; }).join(', ');
    sendToTerminal('[WARN]', pluginCount + ' missing plugin(s): ' + names);
  }

  // Forward to web-bridge
  this._updateUI('asset_missing', JSON.stringify({
    type: 'asset_missing',
    missing: missingFiles,
    plugins: missingPlugins
  }));
};

function sendToTerminal(prefix, msg) {
  try {
    if (typeof messnamed === 'function') {
      messnamed('claude_terminal_in', prefix + ' ' + msg);
    }
  } catch(e) {}
}

// --- Cleanup ---

Hub.prototype.destroy = function() {
  if (this._changePollerTimer) {
    clearInterval(this._changePollerTimer);
  }
  this.cursor.stop();
  this.session.disconnect();
  this.activityLogger.destroy();
  this.crdt.destroy();
  post('coLaB Hub destroyed.\n');
};

// --- M4L JS Entry Points ---
// These functions are called from Max patcher messages

function init() {
  hub = new Hub();
  hub.init();
}

function connect(ip) {
  if (hub) hub.connect(ip);
}

function disconnect() {
  if (hub) hub.disconnect();
}

function setUserName(name) {
  if (hub) hub.setUserName(name);
}

function incoming_state() {
  // Called by Max when [udpreceive] gets state data
  // arguments is the byte list from Max
  if (hub) {
    var bytes = Array.prototype.slice.call(arguments);
    hub.network.handleIncomingState(bytes);
  }
}

function incoming_audio() {
  // Called by Max when [udpreceive] gets audio data
  if (hub) {
    var bytes = Array.prototype.slice.call(arguments);
    hub.network.handleIncomingAudio(bytes);
  }
}

function cleanup() {
  if (hub) hub.destroy();
}

// Export for Max JS runtime
if (typeof module !== 'undefined') {
  module.exports = Hub;
}

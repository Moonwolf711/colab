/**
 * coLaB Engine — Unified orchestrator for real-time Ableton collaboration
 *
 * Combines all transport, diff, git, asset, and file sync subsystems
 * into a single require() with one event interface.
 *
 * Subsystems:
 *   - UDP (lan-transport)    → cursor, params, transport (fast, lossy OK)
 *   - TCP (tcp-stack)        → manifests, file transfers, git diffs (guaranteed)
 *   - PCM (pcm-stream)       → 48kHz/16-bit audio channels
 *   - Differ (als-differ)    → semantic .als parsing
 *   - Git (als-git)          → auto-commit on save
 *   - Assets (asset-resolver)→ sample/plugin tracking
 *   - OneDrive watcher       → cloud sync awareness, conflict detection
 *
 * Copyright (c) 2026 Tyler Yianacopolus / Moonwolf. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL — coLaB project original IP.
 *
 * @module colab-engine
 * @version 1.0.0
 * @license PROPRIETARY
 */

var fs = require('fs');
var path = require('path');
var LanTransport = require('./lan-transport');
var TcpStack = require('./tcp-stack');
var pcm = require('./pcm-stream');
var AlsDiffer = require('./als-differ');
var AlsGit = require('./als-git');
var AssetResolver = require('./asset-resolver');
var SyncController = require('./sync-controller');
var C = require('../shared/constants');
var protocol = require('../shared/protocol');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var SAVE_WINDOW_MS = 5000;       // window to distinguish local vs OneDrive save
var ONEDRIVE_POLL_MS = 2000;     // check for OneDrive conflict files
var MANIFEST_EXCHANGE_DELAY = 3000; // wait after connect before exchanging manifests
var AUDIO_EXTENSIONS = C.AUDIO_EXTENSIONS;
var PRESET_EXTENSIONS = C.PRESET_EXTENSIONS;

// ---------------------------------------------------------------------------
// CoLabEngine
// ---------------------------------------------------------------------------

function CoLabEngine(options) {
  options = options || {};

  // --- Project config ---
  this.projectPath = options.projectPath || null;
  this.alsFile = options.alsFile || null;
  this._alsFullPath = null;

  // --- Peer config ---
  this.peerIp = options.peerIp || null;
  this.role = options.role || 'auto'; // 'server' | 'client' | 'auto'

  // --- Port config ---
  this._udpPort = options.udpPort || C.STATE_PORT;           // 4243
  this._tcpPort = options.tcpPort || C.TCP_PORT || 4260;
  this._udpDataPort = options.udpDataPort || C.DATA_PORT;    // 4253

  // --- Subsystems ---
  this.udp = new LanTransport({
    localPort: this._udpPort,
    dataPort: this._udpDataPort,
    bufferMs: options.udpBufferMs || 20
  });

  this.tcp = new TcpStack({
    port: this._tcpPort,
    sendBufferSize: options.tcpBufferBytes || 256 * 1024
  });
  if (options.networkQuality) {
    this.tcp.setNetworkQuality(options.networkQuality);
  }

  this.differ = new AlsDiffer();

  this.git = new AlsGit({
    autoPush: options.autoPush !== false,
    remote: options.gitRemote || 'origin',
    branch: options.gitBranch || 'main',
    commitPrefix: options.commitPrefix || '[coLaB]'
  });

  this.assets = new AssetResolver(null);

  this.audio = new pcm.PcmMixer(this.udp, {
    frameSamples: options.audioFrameSamples || pcm.DEFAULT_FRAME_SAMPLES,
    jitterFrames: options.jitterFrames || 3,
    maxChannels: options.maxAudioChannels || 16
  });

  this._audioSenders = {}; // channelId → PcmSender

  // --- AbletonBridge LiveSync ---
  this._syncEnabled = options.syncEnabled !== false;
  this._syncOptions = {
    userId: options.userId || 'local',
    abletonHost: options.abletonHost || '127.0.0.1',
    abletonPort: options.abletonPort || C.ABLETON_BRIDGE_PORT,
    abletonUdpPort: options.abletonUdpPort || C.ABLETON_BRIDGE_UDP_PORT
  };
  this.sync = null; // initialized in start()

  // --- OneDrive watcher ---
  this._oneDriveEnabled = options.oneDriveSync !== false;
  this._conflictAlert = options.conflictAlert !== false;
  this._oneDriveWatcher = null;
  this._oneDrivePollTimer = null;
  this._knownConflicts = {};

  // --- ALS watching ---
  this._alsWatcher = null;
  this._lastAlsSnapshot = null;
  this._lastLocalSaveTime = 0;

  // --- State ---
  this._started = false;
  this._connected = false;

  // --- Events ---
  this._handlers = {};

  // --- Wire internal events ---
  this._wireSubsystems();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

CoLabEngine.prototype.start = function(callback) {
  var self = this;
  if (this._started) return callback && callback(new Error('already started'));

  // Resolve .als path
  if (this.projectPath && this.alsFile) {
    this._alsFullPath = path.join(this.projectPath, this.alsFile);
  }

  var pending = 2; // UDP + TCP
  var errors = [];
  var finished = false;

  function done(err) {
    if (finished) return;
    if (err) errors.push(err);
    if (--pending <= 0) {
      finished = true;
      self._started = true;
      self._startOneDriveWatcher();
      self._startAlsWatcher();
      self._startGitWatcher();
      if (self.projectPath) self.assets.setProjectPath(self.projectPath);

      // Start AbletonBridge LiveSync (non-blocking — connects to Ableton in background)
      if (self._syncEnabled) {
        self.sync = new SyncController(self, self._syncOptions);
        self.sync.start(function(syncErr) {
          if (syncErr) {
            self._emit('error', { source: 'sync', error: syncErr.message });
          } else {
            self._emit('sync_started');
          }
        });

        // Forward sync events to engine event bus
        self.sync.on('param_change', function(data) { self._emit('sync_param', data); });
        self.sync.on('partner_cursor', function(data) { self._emit('sync_cursor', data); });
        self.sync.on('conflict', function(data) { self._emit('sync_conflict', data); });
        self.sync.on('config_changed', function(data) { self._emit('sync_config', data); });
        self.sync.on('change_logged', function(data) { self._emit('sync_change', data); });
      }

      self._emit('started', { errors: errors });
      if (callback) { var cb = callback; callback = null; cb(errors.length > 0 ? errors[0] : null); }
    }
  }

  // Start UDP
  if (this.peerIp) {
    this.udp.bind(this.peerIp, function(err) { done(err); });
  } else {
    done(null); // defer UDP until connectToPeer()
  }

  // Start TCP
  if (this.role === 'server' || (this.role === 'auto' && !this.peerIp)) {
    this.tcp.listen(this._tcpPort, function(err) { done(err); });
  } else if (this.peerIp) {
    this.tcp.connect(this.peerIp, this._tcpPort, function(err) { done(err); });
  } else {
    this.tcp.listen(this._tcpPort, function(err) { done(err); });
  }
};

CoLabEngine.prototype.connectToPeer = function(peerIp, callback) {
  var self = this;
  this.peerIp = peerIp;

  // Bind UDP to peer
  if (!this.udp._bound) {
    this.udp.bind(peerIp, function(err) {
      if (err) return callback && callback(err);
    });
  }

  // Connect TCP if not already connected
  if (!this.tcp.isConnected()) {
    this.tcp.connect(peerIp, this._tcpPort, function(err) {
      if (err) return callback && callback(err);
      self._connected = true;
      self._emit('connect', { address: peerIp });

      // Exchange manifests after a short delay
      setTimeout(function() { self._exchangeManifests(); }, MANIFEST_EXCHANGE_DELAY);

      if (callback) callback(null);
    });
  } else {
    if (callback) callback(null);
  }
};

CoLabEngine.prototype.stop = function() {
  this._started = false;
  this._connected = false;

  // Stop watchers
  if (this._alsWatcher) { this._alsWatcher.close(); this._alsWatcher = null; }
  if (this._oneDriveWatcher) { this._oneDriveWatcher.close(); this._oneDriveWatcher = null; }
  if (this._oneDrivePollTimer) { clearInterval(this._oneDrivePollTimer); this._oneDrivePollTimer = null; }

  // Stop sync
  if (this.sync) { this.sync.stop(); this.sync = null; }

  // Stop subsystems
  this.git.destroy();
  this.audio.destroy();
  Object.keys(this._audioSenders).forEach(function(id) {
    this._audioSenders[id].stop();
  }.bind(this));
  this._audioSenders = {};

  this.udp.destroy();
  this.tcp.destroy();

  this._emit('stopped');
};

// ---------------------------------------------------------------------------
// Wiring: connect subsystem events to the unified event bus
// ---------------------------------------------------------------------------

CoLabEngine.prototype._wireSubsystems = function() {
  var self = this;

  // --- UDP events → engine events ---
  this.udp.on('state', function(data) { self._emit('state', data); });
  this.udp.on('cursor', function(data) {
    if (data.length >= 8) {
      var header = protocol.parseCursorPacket(data);
      self._emit('cursor', header);
    }
  });
  this.udp.on('heartbeat', function() { self._emit('heartbeat'); });
  this.udp.on('rtt', function(ms) { self._emit('rtt', { source: 'udp', ms: ms }); });
  this.udp.on('discovery', function(data) { self._emit('discovery', data); });
  this.udp.on('buffer_adjusted', function(ms) { self._emit('buffer_adjusted', ms); });

  // --- TCP events → engine events ---
  this.tcp.on('connect', function(info) {
    self._connected = true;
    self._emit('connect', info);
    setTimeout(function() { self._exchangeManifests(); }, MANIFEST_EXCHANGE_DELAY);
  });
  this.tcp.on('disconnect', function(reason) {
    self._connected = false;
    self._emit('disconnect', reason);
  });
  this.tcp.on('state', function(data) { self._emit('state', data); });
  this.tcp.on('cursor', function(data) { self._emit('cursor', data); });
  this.tcp.on('rtt', function(ms) { self._emit('rtt', { source: 'tcp', ms: ms }); });
  this.tcp.on('bandwidth', function(bw) { self._emit('bandwidth', bw); });
  this.tcp.on('backpressure', function(info) { self._emit('backpressure', info); });
  this.tcp.on('timeout', function(elapsed) { self._emit('timeout', elapsed); });
  this.tcp.on('reconnecting', function(attempt) { self._emit('reconnecting', attempt); });

  // --- TCP reliable data events ---
  this.tcp.on('asset_manifest', function(payload) {
    try {
      var manifest = JSON.parse(payload.toString('utf8'));
      self._handlePeerManifest(manifest);
    } catch(e) {}
  });
  this.tcp.on('asset_transfer', function(payload) {
    var file = TcpStack.parseFileTransfer(payload);
    self._handlePeerFile(file);
  });
  this.tcp.on('asset_missing', function(payload) {
    try {
      var alert = JSON.parse(payload.toString('utf8'));
      self._emit('asset_missing', alert);
    } catch(e) {}
  });

  // --- Git events → engine events ---
  this.git.onCommit(function(hash, message, diff) {
    self._emit('git_commit', { hash: hash, message: message, diff: diff });
    // Send the diff to peer via TCP
    if (self._connected && diff) {
      self.tcp.sendMessage(C.PKT.STATE_UPDATE, {
        type: 'git_diff',
        hash: hash,
        message: message.split('\n')[0],
        changes: diff.changes.length,
        summary: diff.summary
      });
    }
  });
  this.git.onPush(function(hash) { self._emit('git_push', hash); });
  this.git.onDiff(function(diffResult) {
    self._emit('als_diff', {
      changes: diffResult.changes,
      summary: diffResult.summary,
      text: self.differ.formatText(diffResult)
    });
  });
  this.git.onError(function(err) { self._emit('git_error', err); });

  // --- Audio events ---
  this.udp.on('audio', function(data) {
    // Route to mixer (auto-creates channels)
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      self.audio._routeAudio(data);
    }
  });
};

// ---------------------------------------------------------------------------
// ALS file watcher (semantic diff on every save)
// ---------------------------------------------------------------------------

CoLabEngine.prototype._startAlsWatcher = function() {
  if (!this._alsFullPath || !fs.existsSync(this._alsFullPath)) return;
  var self = this;

  // Take initial snapshot
  try {
    this._lastAlsSnapshot = this.differ.parseSync(fs.readFileSync(this._alsFullPath));
  } catch(e) {
    this._emit('error', { source: 'als_watcher', error: e.message });
    return;
  }

  var debounce = null;
  var alsFilename = path.basename(this._alsFullPath);

  this._alsWatcher = fs.watch(path.dirname(this._alsFullPath), function(event, filename) {
    if (filename !== alsFilename) return;
    if (debounce) clearTimeout(debounce);

    debounce = setTimeout(function() {
      self._lastLocalSaveTime = Date.now();
      self._processAlsSave();
    }, 1500);
  });
};

CoLabEngine.prototype._processAlsSave = function() {
  if (!this._alsFullPath) return;
  try {
    var buf = fs.readFileSync(this._alsFullPath);
    if (buf.length === 0) return;
    var newTree = this.differ.parseSync(buf);

    if (this._lastAlsSnapshot) {
      var diffResult = this.differ._diffTrees(this._lastAlsSnapshot, newTree);
      if (diffResult.changes.length > 0) {
        this._emit('als_diff', {
          changes: diffResult.changes,
          summary: diffResult.summary,
          text: this.differ.formatText(diffResult),
          source: 'local'
        });

        // Send diff summary to peer via TCP
        if (this._connected) {
          this.tcp.sendMessage(C.PKT.STATE_UPDATE, {
            type: 'als_save',
            changeCount: diffResult.changes.length,
            summary: diffResult.summary,
            text: this.differ.formatText(diffResult)
          });
        }
      }
    }
    this._lastAlsSnapshot = newTree;
  } catch(e) {
    this._emit('error', { source: 'als_save', error: e.message });
  }
};

// ---------------------------------------------------------------------------
// Git watcher
// ---------------------------------------------------------------------------

CoLabEngine.prototype._startGitWatcher = function() {
  if (!this._alsFullPath || !fs.existsSync(this._alsFullPath)) return;
  this.git.ensureGitignore();
  this.git.ensureGitattributes();
  this.git.watch(this._alsFullPath);
};

// ---------------------------------------------------------------------------
// OneDrive watcher — detects cloud sync changes and conflict files
// ---------------------------------------------------------------------------

CoLabEngine.prototype._startOneDriveWatcher = function() {
  if (!this._oneDriveEnabled || !this.projectPath) return;
  var self = this;

  // Watch project folder recursively
  try {
    this._oneDriveWatcher = fs.watch(this.projectPath, { recursive: true }, function(event, filename) {
      if (!filename) return;
      self._onFileChange(filename);
    });
  } catch(e) {
    // recursive watch not supported on all platforms
    this._emit('error', { source: 'onedrive_watcher', error: e.message });
  }

  // Poll for conflict files (OneDrive creates "file (1).als" pattern)
  this._oneDrivePollTimer = setInterval(function() {
    self._scanForConflicts();
  }, ONEDRIVE_POLL_MS);
};

CoLabEngine.prototype._onFileChange = function(filename) {
  var ext = path.extname(filename).toLowerCase();
  var fullPath = path.join(this.projectPath, filename);

  // .als file changed
  if (ext === '.als') {
    // Is this a conflict file? (e.g., "project (1).als", "project (Tyler's conflicted copy).als")
    if (/\(\d+\)\.als$/.test(filename) || /conflicted copy/i.test(filename)) {
      this._handleConflict(filename, fullPath);
      return;
    }

    // Is this our .als file being changed by OneDrive (partner's save synced)?
    if (path.basename(filename) === this.alsFile) {
      var timeSinceLocalSave = Date.now() - this._lastLocalSaveTime;
      if (timeSinceLocalSave > SAVE_WINDOW_MS) {
        // NOT a local save — this is OneDrive syncing partner's changes
        this._handlePartnerSync(fullPath);
      }
      // else: this is our own save, already handled by _processAlsSave
    }
    return;
  }

  // Audio/preset file changed — update manifest
  if (AUDIO_EXTENSIONS.indexOf(ext) !== -1 || PRESET_EXTENSIONS.indexOf(ext) !== -1) {
    this._emit('file_changed', { path: filename, ext: ext });
    // Rebuild manifest and notify peer
    if (this._connected) {
      var manifest = this.assets.buildManifest();
      if (manifest) {
        this.tcp.sendManifest(manifest);
      }
    }
  }
};

CoLabEngine.prototype._handlePartnerSync = function(alsPath) {
  try {
    var buf = fs.readFileSync(alsPath);
    if (buf.length === 0) return;
    var newTree = this.differ.parseSync(buf);

    if (this._lastAlsSnapshot) {
      var diffResult = this.differ._diffTrees(this._lastAlsSnapshot, newTree);
      if (diffResult.changes.length > 0) {
        this._emit('partner_saved', {
          changes: diffResult.changes,
          summary: diffResult.summary,
          text: this.differ.formatText(diffResult)
        });
      }
    }
    this._lastAlsSnapshot = newTree;
  } catch(e) {
    this._emit('error', { source: 'partner_sync', error: e.message });
  }
};

CoLabEngine.prototype._handleConflict = function(filename, fullPath) {
  if (this._knownConflicts[filename]) return;
  this._knownConflicts[filename] = true;

  this._emit('conflict', {
    filename: filename,
    fullPath: fullPath,
    hint: 'OneDrive created a conflict copy. Both users may have saved simultaneously.'
  });

  // Try to diff the conflict file against the main .als
  if (this._alsFullPath && fs.existsSync(this._alsFullPath)) {
    try {
      this.differ.diff(this._alsFullPath, fullPath, function(err, result) {
        if (!err && result) {
          this._emit('conflict_diff', {
            filename: filename,
            changes: result.changes,
            summary: result.summary,
            text: this.differ.formatText(result)
          });
        }
      }.bind(this));
    } catch(e) {}
  }
};

CoLabEngine.prototype._scanForConflicts = function() {
  if (!this.projectPath || !this._conflictAlert) return;
  try {
    var files = fs.readdirSync(this.projectPath);
    for (var i = 0; i < files.length; i++) {
      if (/\(\d+\)\.als$/.test(files[i]) || /conflicted copy/i.test(files[i])) {
        this._handleConflict(files[i], path.join(this.projectPath, files[i]));
      }
    }
  } catch(e) {}
};

// ---------------------------------------------------------------------------
// Asset manifest exchange
// ---------------------------------------------------------------------------

CoLabEngine.prototype._exchangeManifests = function() {
  if (!this.projectPath) return;
  var manifest = this.assets.buildManifest();
  if (!manifest) return;

  this._emit('manifest_built', {
    fileCount: manifest.files.length,
    pluginCount: manifest.plugins.length
  });

  this.tcp.sendManifest(manifest);
};

CoLabEngine.prototype._handlePeerManifest = function(manifest) {
  this._emit('peer_manifest', manifest);

  // Compare against local
  var result = this.assets.resolveAgainst(manifest);
  if (result.missing.length > 0 || result.plugins.length > 0) {
    this._emit('asset_missing', {
      missing: result.missing,
      plugins: result.plugins
    });
  }
};

CoLabEngine.prototype._handlePeerFile = function(file) {
  if (!this.projectPath) return;
  var result = this.assets.receiveFile(file.path, file.data);
  this._emit('file_received', {
    path: file.path,
    size: file.data.length,
    ok: result.ok
  });
};

// ---------------------------------------------------------------------------
// Send API — unified interface
// ---------------------------------------------------------------------------

CoLabEngine.prototype.sendCursor = function(trackIdx, sceneIdx, editing, userId) {
  var pkt = Buffer.from(protocol.buildCursorPacket(
    this.udp._txSeq || 0, trackIdx, sceneIdx, editing, userId || 'local'
  ));
  this.udp.sendCursor(pkt);
};

CoLabEngine.prototype.sendParam = function(trackIdx, param, value) {
  var data = JSON.stringify({ type: 'param', track: trackIdx, param: param, value: value });
  var buf = Buffer.alloc(5 + data.length);
  buf[0] = C.PKT.STATE_UPDATE;
  buf.writeUInt32LE(this.udp._txSeq || 0, 1);
  Buffer.from(data).copy(buf, 5);
  this.udp.sendState(buf);
};

CoLabEngine.prototype.sendTransport = function(playing, tempo) {
  var data = JSON.stringify({ type: 'transport', playing: playing, tempo: tempo });
  var buf = Buffer.alloc(5 + data.length);
  buf[0] = C.PKT.STATE_UPDATE;
  buf.writeUInt32LE(this.udp._txSeq || 0, 1);
  Buffer.from(data).copy(buf, 5);
  this.udp.sendState(buf);
};

CoLabEngine.prototype.sendFile = function(relativePath, fileData, callback) {
  this.tcp.sendFile(relativePath, fileData);
  if (callback) callback(null);
};

CoLabEngine.prototype.streamAudio = function(channelId, pcmData) {
  if (!this._audioSenders[channelId]) {
    this._audioSenders[channelId] = new pcm.PcmSender(this.udp, {
      channelId: channelId,
      channels: 1,
      frameSamples: pcm.DEFAULT_FRAME_SAMPLES
    });
    this._audioSenders[channelId].start();
  }
  this._audioSenders[channelId].writeSamples(pcmData);
};

CoLabEngine.prototype.commitNow = function(message) {
  this.git.commitNow(message);
};

CoLabEngine.prototype.ping = function() {
  this.udp.sendPing();
  this.tcp.sendPing();
};

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

CoLabEngine.prototype.getStats = function() {
  return {
    started: this._started,
    connected: this._connected,
    peerIp: this.peerIp,
    projectPath: this.projectPath,
    alsFile: this.alsFile,
    udp: this.udp.getStats(),
    tcp: this.tcp.getStats(),
    audio: this.audio.getStats(),
    assets: this.assets.getSummary(),
    oneDrive: {
      enabled: this._oneDriveEnabled,
      watching: !!this._oneDriveWatcher,
      knownConflicts: Object.keys(this._knownConflicts).length
    },
    sync: this.sync ? this.sync.getFullState() : null
  };
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

CoLabEngine.prototype.on = function(event, handler) {
  if (!this._handlers[event]) this._handlers[event] = [];
  this._handlers[event].push(handler);
};

CoLabEngine.prototype.off = function(event, handler) {
  if (!this._handlers[event]) return;
  var idx = this._handlers[event].indexOf(handler);
  if (idx !== -1) this._handlers[event].splice(idx, 1);
};

CoLabEngine.prototype._emit = function(event, data) {
  var handlers = this._handlers[event];
  if (!handlers) return;
  for (var i = 0; i < handlers.length; i++) {
    try { handlers[i](data); } catch(e) {}
  }
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined') {
  module.exports = CoLabEngine;
}

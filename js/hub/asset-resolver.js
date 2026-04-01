/**
 * coLaB Asset Resolver
 * Manages sample file dependencies, plugin auditing, and Collect All and Save verification.
 * Ensures both peers have all referenced audio files and compatible plugins.
 *
 * Copyright (c) 2026 Tyler Yianacopolus / Moonwolf. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL — coLaB project original IP.
 *
 * @module asset-resolver
 * @version 1.0.0
 * @license PROPRIETARY
 */

var C = require('../shared/constants');

function AssetResolver(liveBridge) {
  this.liveBridge = liveBridge;
  this._projectPath = null;
  this._localManifest = null;   // { files: [{path, size, hash}], plugins: [{name, vendor, version}] }
  this._remoteManifest = null;
  this._missingFiles = [];
  this._missingPlugins = [];
  this._onMissingFiles = null;
  this._onMissingPlugins = null;
  this._onManifestReady = null;
  this._collected = false;      // whether Collect All and Save has been verified
}

// --- Project Path ---

AssetResolver.prototype.setProjectPath = function(path) {
  this._projectPath = path;
};

AssetResolver.prototype.getProjectPath = function() {
  if (this._projectPath) return this._projectPath;

  // Try to read from LiveBridge (uses Song.file_path from LOM)
  if (this.liveBridge && typeof this.liveBridge.getProjectPath === 'function') {
    try {
      this._projectPath = this.liveBridge.getProjectPath();
    } catch (e) {
      // Not in M4L context — projectPath must be set manually
    }
  }

  return this._projectPath;
};

// --- Collect All and Save Verification ---
// LiveAPI cannot trigger File > Collect All and Save directly.
// Instead we verify the project state AFTER the user runs it manually.

AssetResolver.prototype.verifyCollected = function() {
  var projectPath = this.getProjectPath();
  if (!projectPath) return { collected: false, reason: 'no_project_path' };

  // Check if Samples/Collected/ exists and has files
  // This runs in Node context (web-bridge) not M4L JS
  try {
    var fs = require('fs');
    var path = require('path');
    var collectedDir = path.join(projectPath, 'Samples', 'Collected');

    if (!fs.existsSync(collectedDir)) {
      return { collected: false, reason: 'no_collected_folder', hint: 'Run File > Collect All and Save in Ableton first' };
    }

    var files = this._walkDir(collectedDir);
    this._collected = files.length > 0;

    return {
      collected: this._collected,
      fileCount: files.length,
      totalSize: files.reduce(function(sum, f) { return sum + f.size; }, 0),
      path: collectedDir
    };
  } catch (e) {
    return { collected: false, reason: 'fs_error', error: e.message };
  }
};

// --- Sample Manifest ---
// Builds a manifest of all audio files in the project (relative paths + sizes)
// Used to compare what each peer has

AssetResolver.prototype.buildManifest = function() {
  var projectPath = this.getProjectPath();
  if (!projectPath) return null;

  var fs = require('fs');
  var path = require('path');
  var crypto = require('crypto');

  var manifest = {
    projectPath: projectPath,
    timestamp: Date.now(),
    collected: this._collected,
    files: [],
    plugins: []
  };

  // Scan Samples/ directory
  var samplesDir = path.join(projectPath, 'Samples');
  if (fs.existsSync(samplesDir)) {
    var audioFiles = this._walkDir(samplesDir);
    for (var i = 0; i < audioFiles.length; i++) {
      var f = audioFiles[i];
      // Relative path from project root
      var relPath = path.relative(projectPath, f.path).replace(/\\/g, '/');

      // Quick hash: first 4KB + file size (full hash too slow for large files)
      var hash = this._quickHash(f.path, crypto);

      manifest.files.push({
        path: relPath,
        size: f.size,
        hash: hash
      });
    }
  }

  // Scan Presets/ directory for plugin presets
  var presetsDir = path.join(projectPath, 'Presets');
  if (fs.existsSync(presetsDir)) {
    var presetFiles = this._walkDir(presetsDir);
    for (var p = 0; p < presetFiles.length; p++) {
      var pf = presetFiles[p];
      var pRelPath = path.relative(projectPath, pf.path).replace(/\\/g, '/');
      manifest.files.push({
        path: pRelPath,
        size: pf.size,
        hash: this._quickHash(pf.path, crypto),
        isPreset: true
      });
    }
  }

  // Audit plugins via LiveBridge (LOM) or direct LiveAPI
  manifest.plugins = this._auditPlugins();

  // Scan audio file dependencies via LOM (Clip.file_path, Sample.file_path)
  if (this.liveBridge && typeof this.liveBridge.getAudioFileDependencies === 'function') {
    try {
      manifest.audioDeps = this.liveBridge.getAudioFileDependencies();
    } catch (e) {
      manifest.audioDeps = [];
    }
  }

  this._localManifest = manifest;

  if (this._onManifestReady) {
    this._onManifestReady(manifest);
  }

  return manifest;
};

// --- Plugin Audit ---
// Reads all devices in the Live set to build a plugin dependency list

AssetResolver.prototype._auditPlugins = function() {
  // Use LiveBridge's LOM-based method if available (preferred — uses proper LOM API)
  if (this.liveBridge && typeof this.liveBridge.getPluginDevices === 'function') {
    try {
      return this.liveBridge.getPluginDevices();
    } catch (e) {
      // Fall through to direct LiveAPI
    }
  }

  // Fallback: direct LiveAPI (when running inside M4L JS without LiveBridge)
  var plugins = [];
  try {
    var liveSet = new LiveAPI('live_set');
    var trackCount = liveSet.getcount('tracks');

    for (var t = 0; t < trackCount; t++) {
      var track = new LiveAPI('live_set tracks ' + t);
      var deviceCount = track.getcount('devices');
      var trackName = track.get('name').toString();

      for (var d = 0; d < deviceCount; d++) {
        var device = new LiveAPI('live_set tracks ' + t + ' devices ' + d);
        var className = device.get('class_name').toString();
        var deviceName = device.get('name').toString();
        var deviceType = parseInt(device.get('type')); // 0=undefined, 1=instrument, 2=audio_effect, 4=midi_effect

        var isPlugin = className === 'PluginDevice' ||
                       className === 'AuPluginDevice' ||
                       className === 'Vst3PluginDevice';

        if (isPlugin) {
          plugins.push({
            name: deviceName,
            className: className,
            type: deviceType,
            isActive: parseInt(device.get('is_active')) === 1,
            track: trackName,
            trackIndex: t,
            deviceIndex: d
          });
        }
      }
    }
  } catch (e) {
    // Not in M4L context — plugin audit only works inside Max
  }

  return plugins;
};

// --- Missing File Detection ---
// Compare local files against remote manifest to find gaps

AssetResolver.prototype.resolveAgainst = function(remoteManifest) {
  this._remoteManifest = remoteManifest;
  this._missingFiles = [];
  this._missingPlugins = [];

  if (!this._localManifest) {
    this.buildManifest();
  }
  if (!this._localManifest) return { missing: [], plugins: [] };

  var fs = require('fs');
  var path = require('path');
  var projectPath = this.getProjectPath();

  // Build lookup of local files by relative path
  var localFileMap = {};
  for (var i = 0; i < this._localManifest.files.length; i++) {
    var lf = this._localManifest.files[i];
    localFileMap[lf.path] = lf;
  }

  // Check each remote file against local
  for (var r = 0; r < remoteManifest.files.length; r++) {
    var rf = remoteManifest.files[r];
    var localFile = localFileMap[rf.path];

    if (!localFile) {
      // File doesn't exist locally at all
      this._missingFiles.push({
        path: rf.path,
        size: rf.size,
        hash: rf.hash,
        reason: 'not_found',
        isPreset: rf.isPreset || false
      });
    } else if (localFile.hash !== rf.hash) {
      // File exists but differs (different version/content)
      this._missingFiles.push({
        path: rf.path,
        size: rf.size,
        hash: rf.hash,
        localHash: localFile.hash,
        reason: 'hash_mismatch',
        isPreset: rf.isPreset || false
      });
    }
  }

  // Check plugins — compare by name (version matching is best-effort)
  if (remoteManifest.plugins) {
    var localPluginNames = {};
    for (var lp = 0; lp < this._localManifest.plugins.length; lp++) {
      localPluginNames[this._localManifest.plugins[lp].name] = true;
    }

    for (var rp = 0; rp < remoteManifest.plugins.length; rp++) {
      var plugin = remoteManifest.plugins[rp];
      if (!localPluginNames[plugin.name]) {
        this._missingPlugins.push({
          name: plugin.name,
          className: plugin.className,
          type: plugin.type,
          track: plugin.track,
          reason: 'not_installed'
        });
      }
    }
  }

  // Fire callbacks
  if (this._missingFiles.length > 0 && this._onMissingFiles) {
    this._onMissingFiles(this._missingFiles);
  }
  if (this._missingPlugins.length > 0 && this._onMissingPlugins) {
    this._onMissingPlugins(this._missingPlugins);
  }

  return {
    missing: this._missingFiles,
    plugins: this._missingPlugins
  };
};

// --- File Transfer Support ---
// Reads a file from the project for transfer to partner

AssetResolver.prototype.getFileForTransfer = function(relativePath) {
  var fs = require('fs');
  var path = require('path');
  var projectPath = this.getProjectPath();
  if (!projectPath) return null;

  var fullPath = path.join(projectPath, relativePath);

  // Security: ensure the resolved path is within the project
  var resolved = path.resolve(fullPath);
  if (resolved.indexOf(path.resolve(projectPath)) !== 0) {
    return null; // path traversal attempt
  }

  if (!fs.existsSync(resolved)) return null;

  var stat = fs.statSync(resolved);
  if (stat.size > C.MAX_TRANSFER_FILE_SIZE) {
    return { error: 'file_too_large', size: stat.size, limit: C.MAX_TRANSFER_FILE_SIZE };
  }

  return {
    path: relativePath,
    size: stat.size,
    data: fs.readFileSync(resolved)
  };
};

// Writes a received file to the project directory

AssetResolver.prototype.receiveFile = function(relativePath, data) {
  var fs = require('fs');
  var path = require('path');
  var projectPath = this.getProjectPath();
  if (!projectPath) return { ok: false, reason: 'no_project_path' };

  var fullPath = path.join(projectPath, relativePath);

  // Security: ensure path is within project
  var resolved = path.resolve(fullPath);
  if (resolved.indexOf(path.resolve(projectPath)) !== 0) {
    return { ok: false, reason: 'path_traversal' };
  }

  // Create directories as needed
  var dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolved, data);

  return { ok: true, path: relativePath, size: data.length };
};

// --- Event Registration ---

AssetResolver.prototype.onMissingFiles = function(callback) {
  this._onMissingFiles = callback;
};

AssetResolver.prototype.onMissingPlugins = function(callback) {
  this._onMissingPlugins = callback;
};

AssetResolver.prototype.onManifestReady = function(callback) {
  this._onManifestReady = callback;
};

// --- Summary ---

AssetResolver.prototype.getSummary = function() {
  return {
    projectPath: this._projectPath,
    collected: this._collected,
    localFiles: this._localManifest ? this._localManifest.files.length : 0,
    localPlugins: this._localManifest ? this._localManifest.plugins.length : 0,
    missingFiles: this._missingFiles.length,
    missingPlugins: this._missingPlugins.length,
    transferReady: this._collected && this._missingFiles.length === 0
  };
};

// --- Internal Helpers ---

AssetResolver.prototype._walkDir = function(dir) {
  var fs = require('fs');
  var path = require('path');
  var results = [];

  var entries;
  try { entries = fs.readdirSync(dir); }
  catch (e) { return results; }

  for (var i = 0; i < entries.length; i++) {
    var fullPath = path.join(dir, entries[i]);
    var stat;
    try { stat = fs.statSync(fullPath); }
    catch (e) { continue; }

    if (stat.isDirectory()) {
      results = results.concat(this._walkDir(fullPath));
    } else {
      // Only include audio files and presets
      var ext = path.extname(entries[i]).toLowerCase();
      if (C.AUDIO_EXTENSIONS.indexOf(ext) !== -1 ||
          C.PRESET_EXTENSIONS.indexOf(ext) !== -1) {
        results.push({ path: fullPath, size: stat.size });
      }
    }
  }

  return results;
};

AssetResolver.prototype._quickHash = function(filePath, crypto) {
  var fs = require('fs');
  var hash = crypto.createHash('sha256');

  // Read first 4KB for quick comparison
  var fd = fs.openSync(filePath, 'r');
  var buf = Buffer.alloc(4096);
  var bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
  fs.closeSync(fd);

  hash.update(buf.slice(0, bytesRead));

  // Include file size in hash for extra discrimination
  var stat = fs.statSync(filePath);
  hash.update(stat.size.toString());

  return hash.digest('hex').substring(0, 16); // truncate — collision risk acceptable for manifest comparison
};

if (typeof module !== 'undefined') {
  module.exports = AssetResolver;
}

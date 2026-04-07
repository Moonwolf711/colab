/**
 * coLaB ALS Git Integration
 * Watches .als saves → semantic diff → auto-commit with descriptive message → push
 *
 * Copyright (c) 2026 Moonwolf / coLaB Project
 * All rights reserved. Proprietary and confidential.
 */

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var AlsDiffer = require('./als-differ');

function AlsGit(options) {
  options = options || {};

  this.differ = new AlsDiffer();
  this._watching = false;
  this._watcher = null;
  this._debounceTimer = null;
  this._lastSnapshot = null;
  this._alsPath = null;
  this._projectDir = null;
  this._remoteName = options.remote || 'origin';
  this._branchName = options.branch || 'main';
  this._autoPush = options.autoPush !== false; // default: push after commit
  this._commitPrefix = options.commitPrefix || '[coLaB]';
  this._debounceMs = options.debounceMs || 2000; // Ableton writes aren't atomic
  this._onCommit = null;
  this._onPush = null;
  this._onError = null;
  this._onDiff = null;
  this._onRawSave = null;   // fires with (bufferOfAlsBytes, alsPath) — before diff parse
  this._commitQueue = [];
  this._committing = false;
}

// --- Watch an .als file for saves ---

AlsGit.prototype.watch = function(alsPath) {
  if (this._watching) this.unwatch();

  if (!fs.existsSync(alsPath)) {
    this._emitError('File not found: ' + alsPath);
    return false;
  }

  this._alsPath = path.resolve(alsPath);
  this._projectDir = path.dirname(this._alsPath);

  // Verify git repo exists
  if (!this._isGitRepo(this._projectDir)) {
    // Initialize one
    this._git(['init'], function(err) {
      if (err) this._emitError('git init failed: ' + err);
    }.bind(this));
  }

  // Take initial snapshot
  try {
    this._lastSnapshot = this.differ.parseSync(fs.readFileSync(this._alsPath));
  } catch (e) {
    this._emitError('Failed to parse initial .als: ' + e.message);
    return false;
  }

  // Watch the directory (Ableton does rename+write, not in-place write)
  var alsFilename = path.basename(this._alsPath);
  this._watcher = fs.watch(path.dirname(this._alsPath), function(eventType, filename) {
    if (filename !== alsFilename) return;
    this._handleFileChange();
  }.bind(this));

  this._watching = true;
  return true;
};

AlsGit.prototype.unwatch = function() {
  if (this._watcher) {
    this._watcher.close();
    this._watcher = null;
  }
  if (this._debounceTimer) {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = null;
  }
  this._watching = false;
};

// --- File Change Handler ---

AlsGit.prototype._handleFileChange = function() {
  // Debounce — Ableton's save is multi-step (temp file → rename → write metadata)
  if (this._debounceTimer) clearTimeout(this._debounceTimer);

  this._debounceTimer = setTimeout(function() {
    this._debounceTimer = null;
    this._processSave();
  }.bind(this), this._debounceMs);
};

AlsGit.prototype._processSave = function() {
  var newBuffer;
  try {
    newBuffer = fs.readFileSync(this._alsPath);
    if (newBuffer.length === 0) return; // incomplete write
  } catch (e) {
    return; // file locked during write
  }

  // Fire the raw-save hook BEFORE the (expensive) diff parse, so
  // AlsReplicator can start shipping bytes over the wire immediately
  // and in parallel with the git commit pipeline.
  if (this._onRawSave) {
    try { this._onRawSave(newBuffer, this._alsPath); } catch (e) {}
  }

  var newTree;
  try {
    newTree = this.differ.parseSync(newBuffer);
  } catch (e) {
    this._emitError('Failed to parse saved .als: ' + e.message);
    return;
  }

  // Diff against previous snapshot
  if (!this._lastSnapshot) {
    // First save — commit everything as initial state
    this._lastSnapshot = newTree;
    this._queueCommit(null, 'Initial project snapshot');
    return;
  }

  var diffResult = this.differ._diffTrees(this._lastSnapshot, newTree);
  this._lastSnapshot = newTree;

  if (diffResult.changes.length === 0) return; // no semantic changes

  if (this._onDiff) {
    this._onDiff(diffResult);
  }

  // Generate commit message from diff
  var message = this._generateCommitMessage(diffResult);
  this._queueCommit(diffResult, message);
};

// --- Commit Message Generation ---
// Translates semantic diffs into human-readable git commit messages

AlsGit.prototype._generateCommitMessage = function(diffResult) {
  var s = diffResult.summary;
  var parts = [];

  // Track changes
  if (s.tracksAdded === 1) {
    var addedTrack = diffResult.changes.find(function(c) { return c.category === 'track' && c.type === 'added'; });
    parts.push('Add track' + (addedTrack && addedTrack.detail ? " '" + addedTrack.detail.name + "'" : ''));
  } else if (s.tracksAdded > 1) {
    parts.push('Add ' + s.tracksAdded + ' tracks');
  }

  if (s.tracksRemoved === 1) {
    var removedTrack = diffResult.changes.find(function(c) { return c.category === 'track' && c.type === 'deleted'; });
    parts.push('Remove track' + (removedTrack ? " '" + removedTrack.summary.replace('Removed ', '').replace(/^.*?'/, "'") + "'" : ''));
  } else if (s.tracksRemoved > 1) {
    parts.push('Remove ' + s.tracksRemoved + ' tracks');
  }

  // Device changes
  if (s.devicesAdded > 0) parts.push('Add ' + s.devicesAdded + ' device' + (s.devicesAdded > 1 ? 's' : ''));
  if (s.devicesRemoved > 0) parts.push('Remove ' + s.devicesRemoved + ' device' + (s.devicesRemoved > 1 ? 's' : ''));

  // Clip changes
  if (s.clipsAdded > 0) parts.push('Add ' + s.clipsAdded + ' clip' + (s.clipsAdded > 1 ? 's' : ''));
  if (s.clipsRemoved > 0) parts.push('Remove ' + s.clipsRemoved + ' clip' + (s.clipsRemoved > 1 ? 's' : ''));
  if (s.clipsModified > 0) parts.push('Edit ' + s.clipsModified + ' clip' + (s.clipsModified > 1 ? 's' : ''));

  // Note changes
  var totalNoteChanges = s.notesAdded + s.notesRemoved + s.notesModified;
  if (totalNoteChanges > 0) {
    var noteDetail = [];
    if (s.notesAdded > 0) noteDetail.push('+' + s.notesAdded);
    if (s.notesRemoved > 0) noteDetail.push('-' + s.notesRemoved);
    if (s.notesModified > 0) noteDetail.push('~' + s.notesModified);
    parts.push('Notes ' + noteDetail.join('/'));
  }

  // Transport
  if (s.transportChanged) {
    var tempoChange = diffResult.changes.find(function(c) { return c.path === 'Transport/PhaseNudgeTempo'; });
    if (tempoChange) {
      parts.push('BPM ' + tempoChange.from + '→' + tempoChange.to);
    } else {
      parts.push('Update transport');
    }
  }

  // Mixer changes
  var mixerChanges = diffResult.changes.filter(function(c) { return c.category === 'mixer' || c.category === 'send'; });
  if (mixerChanges.length > 0 && parts.length < 3) {
    parts.push('Adjust mix (' + mixerChanges.length + ' param' + (mixerChanges.length > 1 ? 's' : '') + ')');
  }

  // Track modifications (name, color, routing)
  if (s.tracksModified > 0 && parts.length < 3) {
    parts.push('Modify ' + s.tracksModified + ' track' + (s.tracksModified > 1 ? 's' : ''));
  }

  if (s.scenesChanged && parts.length < 3) {
    parts.push('Update scenes');
  }

  // Build the subject line
  var subject;
  if (parts.length === 0) {
    subject = 'Update project';
  } else if (parts.length <= 2) {
    subject = parts.join(', ');
  } else {
    // Take the two most significant, mention count of others
    subject = parts[0] + ', ' + parts[1] + ' (+' + (parts.length - 2) + ' more)';
  }

  // Build the body with full change list
  var body = this.differ.formatText(diffResult);

  return this._commitPrefix + ' ' + subject + '\n\n' + body;
};

// --- Git Operations ---

AlsGit.prototype._queueCommit = function(diffResult, message) {
  this._commitQueue.push({ diff: diffResult, message: message });
  this._processQueue();
};

AlsGit.prototype._processQueue = function() {
  if (this._committing || this._commitQueue.length === 0) return;
  this._committing = true;

  var item = this._commitQueue.shift();
  this._doCommit(item.message, function(err, commitHash) {
    if (err) {
      this._emitError('Commit failed: ' + err);
      this._committing = false;
      this._processQueue();
      return;
    }

    if (this._onCommit) {
      this._onCommit(commitHash, item.message, item.diff);
    }

    if (this._autoPush) {
      this._doPush(function(pushErr) {
        if (pushErr) {
          this._emitError('Push failed: ' + pushErr);
        } else if (this._onPush) {
          this._onPush(commitHash);
        }
        this._committing = false;
        this._processQueue();
      }.bind(this));
    } else {
      this._committing = false;
      this._processQueue();
    }
  }.bind(this));
};

AlsGit.prototype._doCommit = function(message, callback) {
  var self = this;

  // Stage all changes in the project directory
  // Use -A to catch new samples, deleted files, and the .als itself
  this._git(['add', '-A'], function(addErr) {
    if (addErr) return callback(addErr);

    // Check if there's anything staged
    self._git(['diff', '--cached', '--quiet'], function(diffErr, diffOut, diffCode) {
      // exit code 1 = there are staged changes (this is good)
      // exit code 0 = nothing staged
      if (diffCode === 0) {
        return callback(null, null); // nothing to commit
      }

      self._git(['commit', '-m', message], function(commitErr, commitOut) {
        if (commitErr) return callback(commitErr);

        // Extract commit hash
        var match = commitOut.match(/\[[\w-]+ ([a-f0-9]+)\]/);
        var hash = match ? match[1] : 'unknown';
        callback(null, hash);
      });
    });
  });
};

AlsGit.prototype._doPush = function(callback) {
  this._git(['push', this._remoteName, this._branchName], function(err) {
    callback(err);
  });
};

// --- Git Helpers ---

AlsGit.prototype._git = function(args, callback) {
  var opts = { cwd: this._projectDir, timeout: 30000 };

  childProcess.execFile('git', args, opts, function(err, stdout, stderr) {
    if (err) {
      // For diff --quiet, exit code 1 means "there are differences" (not an error)
      if (args[0] === 'diff' && err.code === 1) {
        return callback(null, stdout, 1);
      }
      return callback(stderr || err.message);
    }
    callback(null, stdout.trim(), 0);
  });
};

AlsGit.prototype._isGitRepo = function(dir) {
  try {
    var result = childProcess.execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.toString().trim() === 'true';
  } catch (e) {
    return false;
  }
};

// --- Manual Operations ---

// Force a commit right now (even without a new save)
AlsGit.prototype.commitNow = function(message) {
  if (!this._projectDir) return;
  message = message || this._commitPrefix + ' Manual checkpoint';
  this._queueCommit(null, message);
};

// Get git log for the project
AlsGit.prototype.getLog = function(count, callback) {
  count = count || 20;
  this._git(['log', '--oneline', '-' + count], function(err, stdout) {
    if (err) return callback(err);
    var entries = stdout.split('\n').filter(Boolean).map(function(line) {
      var spaceIdx = line.indexOf(' ');
      return {
        hash: line.substring(0, spaceIdx),
        message: line.substring(spaceIdx + 1)
      };
    });
    callback(null, entries);
  });
};

// Get diff between two commits
AlsGit.prototype.diffCommits = function(hashA, hashB, callback) {
  // Check out both .als files, diff them semantically
  var self = this;
  var alsFilename = path.basename(this._alsPath);

  this._git(['show', hashA + ':' + alsFilename], function(errA, contentA) {
    if (errA) return callback(errA);

    self._git(['show', hashB + ':' + alsFilename], function(errB, contentB) {
      if (errB) return callback(errB);

      try {
        var result = self.differ.diffSync(Buffer.from(contentA, 'binary'), Buffer.from(contentB, 'binary'));
        callback(null, result);
      } catch (e) {
        callback(e.message);
      }
    });
  });
};

// --- .gitignore for Ableton projects ---

AlsGit.prototype.ensureGitignore = function() {
  if (!this._projectDir) return;

  var gitignorePath = path.join(this._projectDir, '.gitignore');
  var ignoreRules = [
    '# Ableton Live project ignores (coLaB)',
    'Backup/',
    'Ableton Project Info/',
    '*.asd',           // analysis files (regenerated on open)
    'Samples/Processed/',  // processed cache (regenerated)
    'Icon\r',          // macOS icon file
    '.DS_Store',
    'Thumbs.db',
    ''
  ].join('\n');

  if (fs.existsSync(gitignorePath)) {
    var existing = fs.readFileSync(gitignorePath, 'utf8');
    if (existing.indexOf('coLaB') >= 0) return; // already has our rules
    // Append
    fs.writeFileSync(gitignorePath, existing + '\n' + ignoreRules);
  } else {
    fs.writeFileSync(gitignorePath, ignoreRules);
  }
};

// --- .gitattributes for binary .als handling ---

AlsGit.prototype.ensureGitattributes = function() {
  if (!this._projectDir) return;

  var attrPath = path.join(this._projectDir, '.gitattributes');
  var rules = [
    '# coLaB: treat .als as binary but use semantic diff',
    '*.als binary diff=als',
    '*.wav binary',
    '*.aif binary',
    '*.aiff binary',
    '*.mp3 binary',
    '*.flac binary',
    ''
  ].join('\n');

  if (fs.existsSync(attrPath)) {
    var existing = fs.readFileSync(attrPath, 'utf8');
    if (existing.indexOf('diff=als') >= 0) return;
    fs.writeFileSync(attrPath, existing + '\n' + rules);
  } else {
    fs.writeFileSync(attrPath, rules);
  }
};

// --- Event Registration ---

AlsGit.prototype.onCommit = function(callback) { this._onCommit = callback; };
AlsGit.prototype.onPush = function(callback) { this._onPush = callback; };
AlsGit.prototype.onError = function(callback) { this._onError = callback; };
AlsGit.prototype.onDiff = function(callback) { this._onDiff = callback; };
AlsGit.prototype.onRawSave = function(callback) { this._onRawSave = callback; };

AlsGit.prototype._emitError = function(msg) {
  if (this._onError) this._onError(msg);
};

// --- Cleanup ---

AlsGit.prototype.destroy = function() {
  this.unwatch();
  this._commitQueue = [];
};

if (typeof module !== 'undefined') {
  module.exports = AlsGit;
}

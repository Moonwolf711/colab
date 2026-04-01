# coLaB Unified Program — Compilation Analysis

## What the user wants combined

Three capabilities into one program:
1. **UDP/TCP real-time transport** (lan-transport.js + tcp-stack.js)
2. **OneDrive file sync awareness** (fs.watch on shared folder)
3. **Git async versioning** (als-differ.js + als-git.js)

## Current Module Map

```
TRANSPORT LAYER
├── lan-transport.js    UDP — fire-and-forget state, ACK/retransmit files
│     sendState()         → cursor, params (unreliable, fast)
│     sendReliable()      → manifests, file chunks (ACK + retransmit)
│     sendManifest()      → JSON asset manifest
│     sendFile()          → chunked binary transfer
│     setBuffer(ms)       → jitter buffer 5-200ms
│
├── tcp-stack.js        TCP — multiplexed channels, guaranteed delivery
│     sendState()         → CH.STATE (drops on backpressure)
│     sendData()          → CH.DATA (never drops, queues)
│     sendAudio()         → CH.AUDIO (drops on backpressure)
│     sendControl()       → CH.CONTROL (heartbeat, ping)
│     sendManifest()      → JSON on DATA channel
│     sendFile()          → binary on DATA channel
│     setSendBuffer(bytes)→ 16KB-16MB backpressure control
│     setNetworkQuality() → gigabit/fast/wifi/slow presets
│
├── pcm-stream.js       Audio — 48kHz/16-bit PCM channels
│     PcmSender           → writeSamples(), frames → transport
│     PcmReceiver         → jitter buffer, readFrame()
│     PcmChannel          → paired send+receive per track
│     PcmMixer            → multi-channel stereo mixdown
│
DIFF ENGINE
├── als-differ.js       Semantic .als diff (SAX parser, 60+ junk filters)
│     parseSync()         → gzip XML → structural tree
│     diffSync()          → two trees → change list
│     formatText()        → human-readable change summary
│
├── als-git.js          Git auto-commit on save
│     watch(alsPath)      → fs.watch → debounce → diff → commit → push
│     ensureGitignore()   → Ableton-specific .gitignore
│     ensureGitattributes()→ binary diff driver config
│     getLog()            → semantic commit history
│     diffCommits()       → compare two versions semantically
│
FILE MANAGEMENT
├── asset-resolver.js   Sample/plugin dependency tracking
│     buildManifest()     → scan Samples/, Presets/, audit plugins
│     resolveAgainst()    → compare with peer manifest → missing list
│     getFileForTransfer()→ read file with path traversal guard
│     receiveFile()       → write file safely
│     verifyCollected()   → check Collect All and Save ran
│
PROTOCOL
├── protocol.js         Binary packet builders/parsers
│     buildStatePacket()  → [type][seq][crdt bytes]
│     buildCursorPacket() → [type][seq][track][scene][editing][userId]
│     buildAssetManifest()→ [type][seq][JSON]
│     buildHeartbeat()    → [type][seq][timestamp]
│
└── constants.js        Ports, packet types, audio config, limits
```

## How They Compose

The key insight: **UDP and TCP serve different purposes and should run simultaneously**, not replace each other.

```
┌─────────────────────────────────────────────────────┐
│                  colab-engine.js                     │
│                  (unified program)                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ UDP Channel  │  │ TCP Channel  │  │ Audio Ch  │  │
│  │ (lan-transport) │ (tcp-stack)  │  │(pcm-stream│  │
│  │              │  │              │  │           │  │
│  │ cursor ──────┼──┤              │  │ PCM tx/rx │  │
│  │ params ──────┤  │ manifests ──│  │ jitter buf│  │
│  │ transport ───┤  │ file xfer ──│  │ mixer     │  │
│  │ heartbeat ───┤  │ git diffs ──│  │           │  │
│  └──────┬───────┘  └──────┬──────┘  └─────┬─────┘  │
│         │                 │               │         │
│  ┌──────┴─────────────────┴───────────────┴──────┐  │
│  │              Event Bus (unified)              │  │
│  │  'state' | 'cursor' | 'asset_manifest' |     │  │
│  │  'asset_transfer' | 'audio' | 'rtt' |        │  │
│  │  'connect' | 'disconnect' | 'file_changed'   │  │
│  └──────┬─────────────────┬───────────────┬──────┘  │
│         │                 │               │         │
│  ┌──────┴───────┐  ┌──────┴──────┐  ┌────┴──────┐  │
│  │ File Watcher │  │  Git Engine │  │  Differ   │  │
│  │              │  │             │  │           │  │
│  │ OneDrive ────┤  │ als-git ───│  │als-differ │  │
│  │ .als watch ──┤  │ auto-commit│  │ semantic  │  │
│  │ Samples/ ────┤  │ auto-push  │  │ parse     │  │
│  │ conflict ────┤  │ history    │  │ 60+ junk  │  │
│  │ detection    │  │            │  │ filters   │  │
│  └──────────────┘  └────────────┘  └───────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │            Asset Resolver                     │   │
│  │  manifest compare → missing files → auto-xfer│   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Conflict Resolution: What goes where

| Data type | Transport | Why |
|-----------|-----------|-----|
| Cursor position | **UDP** | Stale data is worse than lost data. 15Hz, tiny packets. |
| Parameter tweaks | **UDP** | Same — latest value wins, don't block on old values. |
| Transport (play/stop) | **UDP** | Time-critical, can't wait for TCP retransmit. |
| Heartbeat/ping | **UDP** | Must measure true network latency, not TCP queue. |
| Asset manifests | **TCP** | Must arrive complete and in order. |
| File transfers | **TCP** | Binary integrity required, can't lose chunks. |
| Git diffs | **TCP** | Structured data, needs guaranteed delivery. |
| PCM audio | **UDP** | Real-time, tolerate drops, jitter buffer handles gaps. |
| OneDrive notifications | **TCP** | Metadata about file changes, must be reliable. |

## OneDrive Integration Design

OneDrive sync creates a specific challenge: the .als file is shared between two machines via cloud sync, AND we're doing real-time sync via UDP/TCP. These can conflict.

### Solution: OneDrive as the "source of truth" for project structure, network as the "source of truth" for live state.

```
OneDrive watches for:
  - New/modified .als file    → trigger als-differ, show what partner saved
  - New/modified samples      → update asset manifest, notify peer
  - Conflict files (.als (1)) → alert user, offer merge via als-differ
  - Deleted files             → notify peer of removed assets

Network handles:
  - Cursor position (real-time, not in .als)
  - Parameter values (real-time, written to .als on save)
  - Transport state (real-time, not persisted)
  - Audio monitoring (real-time, not persisted)

Git handles:
  - Version history (immutable record of every save)
  - Semantic diffs (human-readable change descriptions)
  - Conflict resolution (three-way merge via diff trees)
```

### OneDrive Watcher Logic

```javascript
// Watch the shared OneDrive project folder
fs.watch(oneDrivePath, { recursive: true }, function(event, filename) {
  if (filename.endsWith('.als')) {
    // .als file changed — could be local save or OneDrive sync
    if (isLocalSave(filename)) {
      // We saved → run als-differ → commit → send diff to peer
      alsGit.processSave();
    } else {
      // OneDrive synced partner's save → show diff, optionally reload
      var diff = alsDiffer.diffSync(lastSnapshot, readFile(filename));
      emit('partner_saved', diff);
    }
  } else if (isAudioFile(filename) || isPresetFile(filename)) {
    // Sample/preset added or changed → update manifest
    assetResolver.buildManifest();
    tcp.sendManifest(assetResolver.getManifest());
  } else if (filename.match(/\(\d+\)\./)) {
    // OneDrive conflict file (e.g., "project (1).als")
    emit('conflict', filename);
  }
});
```

### Distinguishing Local vs OneDrive Saves

```javascript
// Track saves from our Ableton instance
var lastLocalSaveTime = 0;
var SAVE_WINDOW_MS = 5000;

function onAbletonSave() {
  lastLocalSaveTime = Date.now();
}

function isLocalSave(filename) {
  return (Date.now() - lastLocalSaveTime) < SAVE_WINDOW_MS;
}
```

## Unified API Surface

```javascript
var CoLabEngine = require('./colab-engine');

var engine = new CoLabEngine({
  // Project
  projectPath: 'D:/OneDrive/colab-session/',
  alsFile: 'session.als',

  // Network
  peerIp: '192.168.0.83',
  udpPort: 4243,           // real-time state
  tcpPort: 4260,           // reliable data
  audioPort: 4244,         // PCM streams

  // Buffer tuning
  udpBufferMs: 20,         // jitter buffer for UDP
  tcpBufferBytes: 256*1024,// send buffer for TCP
  networkQuality: 'fast',  // gigabit|fast|wifi|slow

  // Git
  gitEnabled: true,
  gitRemote: 'origin',
  gitBranch: 'main',
  autoPush: true,

  // Audio
  audioChannels: 1,        // mono per stream
  audioFrameMs: 10,        // 480 samples @ 48kHz
  jitterFrames: 3,         // 30ms jitter buffer

  // OneDrive
  oneDriveSync: true,      // watch for cloud sync changes
  conflictAlert: true      // alert on OneDrive conflict files
});

// Events
engine.on('connect', function(peer) { });
engine.on('disconnect', function(reason) { });
engine.on('cursor', function(track, scene, userId) { });
engine.on('param_change', function(trackIdx, param, value) { });
engine.on('transport', function(playing, tempo) { });
engine.on('partner_saved', function(diff) { });
engine.on('conflict', function(filename) { });
engine.on('manifest', function(files, plugins) { });
engine.on('file_received', function(path, size) { });
engine.on('git_commit', function(hash, message) { });
engine.on('rtt', function(ms) { });
engine.on('audio', function(channelId, pcmBuffer) { });

// Actions
engine.start();                          // bind UDP+TCP, watch files, start git
engine.stop();                           // clean shutdown
engine.sendCursor(track, scene);         // via UDP
engine.sendParam(trackIdx, param, val);  // via UDP
engine.sendTransport(playing, tempo);    // via UDP
engine.sendFile(relativePath, buffer);   // via TCP
engine.streamAudio(channelId, pcmData);  // via UDP
engine.commitNow('checkpoint message');  // manual git commit
engine.getStats();                       // all subsystem stats
```

## Build Plan

### What exists (can require directly):
- `tcp-stack.js` — 912 lines, tested
- `lan-transport.js` — 791 lines, tested
- `pcm-stream.js` — 749 lines, tested
- `als-differ.js` — ~1100 lines, tested
- `als-git.js` — 448 lines, tested
- `asset-resolver.js` — 440 lines, tested
- `protocol.js` — 222 lines
- `constants.js` — 66 lines

### What needs building:
- `colab-engine.js` — unified orchestrator (~400 lines estimate)
  - Instantiates all subsystems
  - Wires events between them
  - OneDrive folder watcher with conflict detection
  - Local/remote save discrimination
  - Unified event interface
  - Startup/shutdown lifecycle

### Total: ~5,100 lines existing + ~400 new = one `require('colab-engine')`

# coLaB Project — 8 Independent Workstreams

Total: ~9,900 lines across 20 files. Each workstream is self-contained with clear interfaces. Contributors can work on any module without touching the others.

---

## Workstream 1: Transport Layer (UDP + TCP)
**Owner:** _unassigned_
**Files:**
- `js/hub/lan-transport.js` (792 lines) — UDP with jitter buffer + reliable delivery
- `js/hub/tcp-stack.js` (910 lines) — TCP multiplexed channels
- `js/shared/protocol.js` (221 lines) — Binary packet builders/parsers
- `js/shared/constants.js` (65 lines) — Ports, packet types, config

**Interface:**
```javascript
// Both expose the same event API:
transport.on('state' | 'cursor' | 'heartbeat' | 'asset_manifest' | 'asset_transfer' | 'rtt')
transport.sendState(buf)    // fire-and-forget
transport.sendManifest(obj) // reliable
transport.sendFile(path, data) // reliable
transport.getStats()
```

**Tests:** `test/stress-tcp.js`, `test/stress-tcp-degraded.js`, `test/stress-tcp-real-nic.js`, `test/packet-trace.js`, `test/send-to-haven.js`

**What to work on:**
- [ ] Add peer discovery via UDP multicast (no manual IP entry)
- [ ] Add encryption (TLS for TCP, DTLS for UDP)
- [ ] Connection quality monitoring and auto-switching UDP↔TCP
- [ ] Bandwidth throttling for metered connections

---

## Workstream 2: ALS Diff Engine
**Owner:** _unassigned_
**Files:**
- `js/hub/als-differ.js` (1,163 lines) — SAX-based semantic .als parser + differ
- `js/hub/als-differ.package.json` — IP manifest

**Interface:**
```javascript
differ.parseSync(buffer)           // gzip XML → tree
differ.diffSync(bufferA, bufferB)  // two .als files → change list
differ.formatText(diffResult)      // human-readable summary
```

**What to work on:**
- [ ] Diff device parameters (plugin knobs, macros)
- [ ] Diff automation lanes
- [ ] Diff clip content (MIDI notes, audio warp markers)
- [ ] Three-way merge for conflict resolution
- [ ] Performance: streaming diff without holding both trees in memory

---

## Workstream 3: Git Integration
**Owner:** _unassigned_
**Files:**
- `js/hub/als-git.js` (447 lines) — fs.watch → diff → commit → push pipeline

**Interface:**
```javascript
git.watch(alsPath)           // start watching for saves
git.unwatch()
git.commitNow(message)       // manual checkpoint
git.getLog(count, callback)  // semantic commit history
git.diffCommits(hashA, hashB, callback) // compare versions
git.ensureGitignore()        // Ableton-specific ignores
git.ensureGitattributes()    // binary diff driver
```

**Dependencies:** Workstream 2 (als-differ)

**What to work on:**
- [ ] Branching strategy (one branch per user, merge on sync)
- [ ] Git LFS for large samples
- [ ] Conflict detection and resolution UI
- [ ] Commit signing for IP attribution
- [ ] Session-based branch naming (auto-create per jam session)

---

## Workstream 4: Audio Streaming
**Owner:** _unassigned_
**Files:**
- `js/hub/pcm-stream.js` (749 lines) — 48kHz/16-bit PCM sender, receiver, mixer

**Interface:**
```javascript
// Send
sender = new PcmSender(transport, { channelId, channels, frameSamples })
sender.start()
sender.writeSamples(pcmBuffer)
sender.getMeter() // { peakDb, rmsDb }

// Receive
receiver = new PcmReceiver({ channelId, jitterFrames })
receiver.receiveFrame(data)
receiver.readFrame() // returns PCM buffer
receiver.getBufferLatencyMs()

// Multi-channel
mixer = new PcmMixer(transport, { maxChannels })
mixer.mixDown() // stereo output
```

**What to work on:**
- [ ] Opus codec support (reduce bandwidth from 96KB/s to ~16KB/s)
- [ ] Sample rate conversion (44.1kHz ↔ 48kHz)
- [ ] Per-channel volume/pan controls
- [ ] Latency compensation (align playback with partner's transport position)
- [ ] JACK/ASIO integration for actual audio I/O

---

## Workstream 5: Asset Management
**Owner:** _unassigned_
**Files:**
- `js/hub/asset-resolver.js` (439 lines) — Sample/plugin dependency tracking + transfer

**Interface:**
```javascript
resolver.setProjectPath(path)
resolver.buildManifest()           // scan files + audit plugins
resolver.resolveAgainst(manifest)  // compare → missing list
resolver.getFileForTransfer(path)  // read with security guard
resolver.receiveFile(path, data)   // write safely
resolver.verifyCollected()         // check Collect All and Save
resolver.getSummary()
```

**What to work on:**
- [ ] Automatic file transfer on connect (send missing samples)
- [ ] Delta/incremental transfer (only changed bytes)
- [ ] Plugin compatibility checking (VST2 vs VST3, AU vs VST)
- [ ] Sample format conversion (WAV↔FLAC for transfer compression)
- [ ] Cloud storage integration (S3/R2 for large sample packs)

---

## Workstream 6: M4L Device (Ableton Integration)
**Owner:** _unassigned_
**Files:**
- `colab_hub_v5.js` (1,141 lines) — LiveAPI polling, cursor tracking, param sync, overlay
- `CoLaB_v5.amxd` — Max for Live device (this machine)
- `CoLaB_v5_haven.amxd` — Max for Live device (TheHAVEN)
- `control-panel-ui.js` (16,575 bytes) — v8ui control panel
- `cursor-overlay-ui.js` (11,816 bytes) — v8ui cursor visualization

**Interface (called by Max patcher messages):**
```javascript
init()              // read tracks, start polling
poll()              // detect changes, send diffs + cursor
connect(ip)         // set partner, enable sync
disconnect()
refresh()           // re-read all tracks
incoming(jsonStr)   // apply partner changes via LiveAPI
```

**M4L Patcher wiring:**
```
live.thisdevice → init + metro 500ms → poll
outlet 0 → udpsend partner:8001
outlet 1 → udpsend 127.0.0.1:8003 (web-bridge)
udpreceive 8001 → prepend incoming → js inlet
```

**What to work on:**
- [ ] Higher poll rate (100ms instead of 500ms) with smarter change detection
- [ ] Device parameter tracking (plugin knobs, not just mixer)
- [ ] Clip launch/stop sync
- [ ] Scene launch sync
- [ ] Follow partner cursor option (auto-navigate to their track)
- [ ] Visual cursor overlay improvements (colors, animation)
- [ ] Undo grouping for remote changes

---

## Workstream 7: Engine Orchestrator
**Owner:** _unassigned_
**Files:**
- `js/hub/colab-engine.js` (657 lines) — Unified orchestrator wiring all subsystems

**Interface:**
```javascript
engine = new CoLabEngine({
  projectPath, alsFile, peerIp,
  udpBufferMs, tcpBufferBytes, networkQuality,
  autoPush, gitBranch, oneDriveSync
})
engine.start(callback)
engine.connectToPeer(ip, callback)
engine.sendCursor(track, scene, editing, userId)
engine.sendParam(trackIdx, param, value)
engine.sendTransport(playing, tempo)
engine.sendFile(path, data)
engine.streamAudio(channelId, pcmData)
engine.commitNow(message)
engine.getStats()
engine.on('connect' | 'disconnect' | 'cursor' | 'als_diff' | 'partner_saved' | 'conflict' | ...)
```

**Dependencies:** Workstreams 1-5 (composes them all)

**What to work on:**
- [ ] Auto-discovery (multicast scan for peers on LAN)
- [ ] Multi-peer support (3+ collaborators)
- [ ] Session management (save/restore engine state)
- [ ] Conflict resolution logic (OneDrive vs live edits)
- [ ] Health monitoring dashboard

---

## Workstream 8: Web Bridge + Browser UI
**Owner:** _unassigned_
**Files:**
- `web-bridge/server.js` (931 lines) — HTTP + WebSocket + UDP bridge + engine integration
- `web-bridge/index.html` — Browser client UI

**Interface (HTTP API):**
```
GET  /api/recap              — session recap
GET  /api/session-log        — activity entries
GET  /api/sessions           — saved session files
POST /api/assets/set-project — set project path
GET  /api/assets/manifest    — build + return manifest
POST /api/assets/resolve     — compare against remote manifest
POST /api/als/watch          — start watching .als for diffs
POST /api/als/diff           — diff two .als files
POST /api/git/watch          — start git auto-commit
GET  /api/git/log            — commit history
POST /api/git/diff-commits   — semantic diff between commits
GET  /api/engine/stats       — full engine status
POST /api/engine/start       — start engine with config
POST /api/engine/connect     — connect to peer
POST /api/engine/stop        — stop engine
POST /api/engine/ping        — ping peer
```

**What to work on:**
- [ ] Browser UI redesign (React or Svelte dashboard)
- [ ] Real-time cursor visualization in browser
- [ ] Diff viewer (side-by-side track comparison)
- [ ] Git history timeline with semantic labels
- [ ] Audio level meters for streamed channels
- [ ] Chat/messaging between collaborators
- [ ] Mobile companion app (React Native)

---

## Dependency Graph

```
                    ┌──────────────────┐
                    │  WS8: Web Bridge │
                    │   + Browser UI   │
                    └────────┬─────────┘
                             │ requires
                    ┌────────┴─────────┐
                    │  WS7: Engine     │
                    │  Orchestrator    │
                    └──┬──┬──┬──┬──┬──┘
                       │  │  │  │  │
          ┌────────────┘  │  │  │  └────────────┐
          │       ┌───────┘  │  └───────┐       │
          ▼       ▼          ▼          ▼       ▼
    ┌──────┐ ┌──────┐  ┌──────┐  ┌──────┐ ┌──────┐
    │ WS1  │ │ WS2  │  │ WS3  │  │ WS4  │ │ WS5  │
    │Trans-│ │ ALS  │  │ Git  │  │Audio │ │Asset │
    │port  │ │Differ│  │Integ │  │Stream│ │Mgmt  │
    └──────┘ └──────┘  └──┬───┘  └──────┘ └──────┘
                          │ requires
                          ▼
                     ┌──────┐
                     │ WS2  │
                     │Differ│
                     └──────┘

    ┌──────┐
    │ WS6  │  ← Independent (runs inside Max, talks via UDP)
    │ M4L  │
    │Device│
    └──────┘
```

## How to Contribute

1. Pick a workstream
2. Clone the repo: `git clone https://github.com/Moonwolf711/colab.git`
3. Work ONLY on files in your workstream
4. Test with the existing test files or add new ones in `test/`
5. Interface contracts (the function signatures above) are FROZEN — don't change them
6. PR against `main` with prefix: `[WS1]`, `[WS2]`, etc.

## Quick Start for Each Workstream

```bash
# WS1: Transport — run the stress tests
node test/stress-tcp.js
node test/stress-tcp-real-nic.js

# WS2: Differ — test with a real .als file
node -e "var d=require('./js/hub/als-differ');var fs=require('fs');var t=d.prototype.parseSync(fs.readFileSync('path/to/your.als'));console.log(t.meta)"

# WS3: Git — watch a project
node -e "var g=require('./js/hub/als-git');var w=new g();w.watch('path/to/your.als')"

# WS4: Audio — loopback test
node -e "var p=require('./js/hub/pcm-stream');console.log('frame size:',p.DEFAULT_FRAME_SAMPLES,'samples =',p.DEFAULT_FRAME_MS+'ms')"

# WS5: Assets — scan a project
node -e "var a=require('./js/hub/asset-resolver');var r=new a(null);r.setProjectPath('path/to/project');console.log(r.buildManifest())"

# WS6: M4L — load CoLanew.amxd in Ableton, click compile

# WS7: Engine — full stack test
node -e "var E=require('./js/hub/colab-engine');var e=new E({projectPath:'path/to/project',alsFile:'your.als'});e.start(function(){console.log(e.getStats())})"

# WS8: Web Bridge — start the server
cd web-bridge && node server.js
```

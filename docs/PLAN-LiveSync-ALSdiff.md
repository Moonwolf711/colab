# PLAN MODE: coLaB AbletonBridge LiveSync.ALSdiff

## Objective

Build a real-time two-user Ableton Live collaboration system where both users see each other's cursor, hear each other's changes live, and can independently control what they hear from their partner — all while maintaining a synchronized .als project file with semantic version history.

## Scenario

Two producers on the same LAN (192.168.0.3 and 192.168.0.83) each have Ableton Live 12 open with the same project. Both are actively editing — selecting tracks, tweaking parameters, adding/removing clips, adjusting automation. Each sees a live cursor showing where their partner is working. Each can toggle their partner's audio on/off, mute specific tracks from their partner's perspective, and control advanced sync options.

When either user saves (Cmd+S), the .als file is semantically diffed, auto-committed to git with a human-readable message, and the diff is broadcast to the partner in real-time.

---

## Architecture Overview

```
Machine A (192.168.0.3)                    Machine B (192.168.0.83)
┌──────────────────────┐                   ┌──────────────────────┐
│  Ableton Live 12     │                   │  Ableton Live 12     │
│  ┌────────────────┐  │                   │  ┌────────────────┐  │
│  │ AbletonBridge  │  │                   │  │ AbletonBridge  │  │
│  │ Remote Script  │  │                   │  │ Remote Script  │  │
│  │ TCP :9877      │  │                   │  │ TCP :9877      │  │
│  └───────┬────────┘  │                   │  └───────┬────────┘  │
└──────────┼───────────┘                   └──────────┼───────────┘
           │ TCP localhost                            │ TCP localhost
┌──────────┼───────────┐                   ┌──────────┼───────────┐
│  colab-engine.js     │                   │  colab-engine.js     │
│  ┌────────────────┐  │                   │  ┌────────────────┐  │
│  │ AbletonClient  │◄─┤ observe_property  │  │ AbletonClient  │  │
│  │ (new module)   │──┤ get/set commands  │  │ (new module)   │  │
│  └───────┬────────┘  │                   │  └───────┬────────┘  │
│          │           │                   │          │           │
│  ┌───────┴────────┐  │                   │  ┌───────┴────────┐  │
│  │ SyncController │  │  UDP 4243 (fast)  │  │ SyncController │  │
│  │ (new module)   │◄─┼──────────────────►┼──│ (new module)   │  │
│  │                │  │  TCP 4260 (reliable│  │                │  │
│  │ • cursor sync  │◄─┼──────────────────►┼──│ • cursor sync  │  │
│  │ • param sync   │  │                   │  │ • param sync   │  │
│  │ • transport    │  │                   │  │ • transport    │  │
│  │ • audio toggle │  │                   │  │ • audio toggle │  │
│  │ • clip sync    │  │                   │  │ • clip sync    │  │
│  └───────┬────────┘  │                   │  └───────┬────────┘  │
│          │           │                   │          │           │
│  ┌───────┴────────┐  │                   │  ┌───────┴────────┐  │
│  │ als-differ     │  │  OneDrive / Git   │  │ als-differ     │  │
│  │ als-git        │◄─┼──────────────────►┼──│ als-git        │  │
│  │ asset-resolver │  │                   │  │ asset-resolver │  │
│  └────────────────┘  │                   │  └────────────────┘  │
│                      │                   │                      │
│  web-bridge :3030    │                   │  web-bridge :3030    │
│  (browser UI)        │                   │  (browser UI)        │
└──────────────────────┘                   └──────────────────────┘
```

---

## Dependencies (what exists, what's needed)

### EXISTS — Verified Working

| Module | File | Lines | Status |
|--------|------|-------|--------|
| TCP transport | `js/hub/tcp-stack.js` | 910 | Tested across LAN, 640KB, 0 errors, 4ms RTT |
| UDP transport | `js/hub/lan-transport.js` | 792 | Tested, jitter buffer, reliable mode |
| PCM audio stream | `js/hub/pcm-stream.js` | 749 | 48kHz/16-bit, 500 frames to TheHAVEN, 0 errors |
| ALS semantic differ | `js/hub/als-differ.js` | 1163 | Parses real .als, 60+ junk filters, structural diff |
| Git auto-commit | `js/hub/als-git.js` | 447 | Watches .als, semantic commit messages, auto-push |
| Asset resolver | `js/hub/asset-resolver.js` | 439 | Manifest build, compare, file transfer |
| Engine orchestrator | `js/hub/colab-engine.js` | 657 | Wires all subsystems, OneDrive watcher, conflict detection |
| Web bridge | `web-bridge/server.js` | 931 | HTTP API + WebSocket + engine integration |
| Protocol/constants | `js/shared/protocol.js` + `constants.js` | 286 | Packet builders, port config |
| AbletonBridge Remote Script | `AbletonBridge/AbletonBridge_Remote_Script/` | ~3000 | 280+ commands, TCP :9877, installed on both machines |
| AbletonBridge MCP Server | `AbletonBridge/MCP_Server/` | ~6000 | FastMCP tools, connections, dashboard |
| AbletonBridge M4L Device | `AbletonBridge/M4L_Device/m4l_bridge.js` | ~200 | Deep LOM, audio analysis, UDP 9878/9879 |
| M4L hub (legacy) | `colab_hub_v5.js` | 1141 | LiveAPI polling, cursor overlay — being replaced |

### NEEDS BUILDING

| Module | Purpose | Estimated Lines |
|--------|---------|----------------|
| `js/hub/ableton-client.js` | Node.js TCP client for AbletonBridge Remote Script on :9877. Wraps all 280+ commands. Handles observe_property push events. Replaces M4L LiveAPI polling. | ~400 |
| `js/hub/sync-controller.js` | Orchestrates what syncs between peers and how. Manages sync state, conflict resolution, partner audio toggle, per-track sync permissions. | ~500 |
| `js/hub/cursor-sync.js` | Dedicated cursor tracking module. Uses AbletonBridge `observe_property` on `selected_track` and `selected_scene`. Sends via UDP. Receives partner cursor. Calls `select_track`/highlight on partner updates. | ~200 |
| `js/hub/param-sync.js` | Parameter change detection and forwarding. Uses AbletonBridge `observe_property` on track params. Diffs against local snapshot. Sends deltas via UDP. Applies received deltas via `set_device_parameter`. | ~300 |
| `js/hub/audio-toggle.js` | Partner audio control. Creates/manages a "Partner Monitor" return track or uses existing routing. Toggle mutes partner's audio feed. Per-track granularity. | ~200 |
| `web-bridge/ui/` | Browser dashboard for sync status, partner cursor visualization, audio toggles, diff viewer, git history timeline. | ~800 |

### NPM DEPENDENCIES (already installed or built-in)

```json
{
  "ws": "^8.0.0",          // WebSocket server (web-bridge) — installed
  "sax": "^1.4.1",         // XML parser (als-differ) — installed
  "net": "built-in",       // TCP (tcp-stack, ableton-client)
  "dgram": "built-in",     // UDP (lan-transport)
  "fs": "built-in",        // File watching (als-git, OneDrive)
  "zlib": "built-in",      // .als decompression (als-differ)
  "child_process": "built-in", // git commands (als-git)
  "crypto": "built-in"     // file hashing (asset-resolver)
}
```

### PYTHON DEPENDENCIES (AbletonBridge MCP Server)

```
mcp[cli]>=1.3.0            // MCP framework — installed
```

### ABLETON REQUIREMENTS

- Ableton Live 12.3+ on both machines
- AbletonBridge Remote Script activated as Control Surface on both
- Same .als project file accessible on both (OneDrive or manual copy)

### NETWORK REQUIREMENTS

- Both machines on same LAN (192.168.0.x subnet)
- Firewall ports open: TCP 4260, 9877; UDP 4243, 4253
- Already verified: TCP 4260 connected, 4ms RTT, 640KB transferred

---

## Feature Specification

### Feature 1: Live Dual-Cursor Tracking

**What the user sees:** A colored highlight on the partner's currently selected track in the Session View. When the partner clicks a different track, the highlight moves in real-time (<50ms).

**Implementation:**

```
Machine A:
  ableton-client.js → observe_property("selected_track") on :9877
  → callback fires when user A clicks a track
  → cursor-sync.js packages: {type:"cursor", track:5, scene:2, user:"tyler"}
  → colab-engine → UDP 4243 → Machine B

Machine B:
  UDP 4243 → colab-engine → cursor-sync.js
  → receives partner cursor: track 5, scene 2
  → ableton-client.js → does NOT move B's cursor (just shows highlight)
  → web-bridge → WebSocket → browser UI shows partner position
  → Optional: ableton-client.js → set_track_color flash or view scroll
```

**Observe properties needed:**
- `live_set.view.selected_track` — which track is selected
- `live_set.view.selected_scene` — which scene is selected
- `live_set.view.detail_clip` — which clip is open in detail view

**Data rate:** ~15 updates/sec max (throttled), ~20 bytes each = 300 bytes/sec

### Feature 2: Live Parameter Sync

**What the user sees:** When partner A moves a fader, partner B sees the fader move in real-time. Both can move faders simultaneously — last-write-wins with conflict detection.

**Implementation:**

```
Machine A:
  ableton-client.js → observe_property on each track's mixer params
  → param-sync.js detects: track 2 volume changed from 0.85 to 0.72
  → packages delta: {type:"param", track:2, param:"volume", value:0.72, ts:1234}
  → UDP 4243 → Machine B

Machine B:
  → param-sync.js receives delta
  → checks: is local user currently touching track 2 volume?
    → YES: conflict! queue the remote change, apply after local touch ends
    → NO: ableton-client.js → set_track_volume(2, 0.72)
```

**Synced parameters:**
- Track: volume, pan, mute, solo, arm, send levels, color, name
- Transport: tempo, playing, loop start/end, metronome
- Device: all parameter values (via set_device_parameter)
- Clip: launch, stop, loop points, pitch, name

**Data rate:** ~50-200 updates/sec during active editing, ~100 bytes each = 5-20 KB/sec

### Feature 3: Partner Audio Toggle

**What the user sees:** A button in the browser UI (and optionally in Ableton via a mapped control) that toggles whether they hear their partner's audio changes. When OFF, their Ableton plays only their own edits. When ON, they hear the combined result of both users' edits.

**Implementation options:**

**Option A: PCM Stream (existing infrastructure)**
```
Machine A: pcm-stream.js captures master output → UDP → Machine B
Machine B: receives PCM → routes to a dedicated "Partner Audio" track
Toggle: mute/unmute the Partner Audio track
```

**Option B: Parameter Mirror (lighter weight)**
```
Both machines have the same project loaded.
When param-sync applies partner's changes, both hear the same mix.
Toggle OFF: param-sync stops applying partner's mixer changes locally.
Partner's structural changes (clips, notes) still sync, but mixer is independent.
```

**Option C: Hybrid (recommended)**
```
Structural sync (clips, notes, automation): always on
Mixer sync (volume, pan, sends): toggleable per-track
Transport sync (play/stop/tempo): toggleable
Audio monitoring (PCM stream): toggleable for hearing partner's actual output
```

**Advanced per-track controls:**
```javascript
syncConfig = {
  global: {
    cursorSync: true,       // see partner's cursor
    transportSync: true,    // lock play/stop/tempo
    structureSync: true,    // sync clip add/delete/move
    mixerSync: true,        // sync volume/pan/sends
    audioMonitor: false     // PCM stream of partner's output
  },
  tracks: {
    0: { mixerSync: false },  // "PRE MASTER" — I control my own master
    1: { mixerSync: true },   // "DRUMS" — partner can change drum mix
    // unlisted tracks inherit global setting
  }
}
```

### Feature 4: .als Diff on Save

**What the user sees:** When either user saves, a notification appears showing what changed in human-readable form: "Partner added track 'Vocals', changed tempo 130→140, edited 12 notes in BASS clip"

**Implementation (already built, needs wiring):**

```
User A saves (Cmd+S)
  → als-git.js detects .als change (fs.watch, 2s debounce)
  → als-differ.js: gunzip → SAX parse → strip 60+ junk elements → structural diff
  → generate commit message: "[coLaB] Add track 'Vocals', BPM 130→140, Notes +12/-3"
  → git add -A → git commit → git push
  → colab-engine → TCP 4260 → broadcast diff summary to peer
  → web-bridge → WebSocket → browser shows diff notification

User B receives:
  → notification: "Partner saved: Added track 'Vocals', changed tempo, edited notes"
  → Optional: auto-reload .als from OneDrive (dangerous — would reset B's unsaved changes)
  → Recommended: show diff and let B decide when to reload
```

### Feature 5: Advanced Sync Options (Browser UI)

**Dashboard panels:**

```
┌─────────────────────────────────────────────────────────┐
│  coLaB LiveSync Dashboard                    [●] Connected │
├─────────────┬───────────────────────────────────────────┤
│ PARTNER     │  ● tyler @ 192.168.0.83                   │
│ CURSOR      │  Track: BASS (idx 12)  Scene: 3           │
│ RTT         │  4ms (UDP) / 6ms (TCP)                    │
│ BANDWIDTH   │  ↑ 12 KB/s  ↓ 8 KB/s                     │
├─────────────┼───────────────────────────────────────────┤
│ SYNC        │  [✓] Cursor tracking                      │
│ TOGGLES     │  [✓] Transport lock (play/stop/tempo)     │
│             │  [✓] Structure sync (clips/notes)          │
│             │  [✓] Mixer sync (volume/pan/sends)         │
│             │  [ ] Audio monitor (PCM stream)            │
├─────────────┼───────────────────────────────────────────┤
│ PER-TRACK   │  [✓] DRUMS — mixer sync ON                │
│ OVERRIDES   │  [✗] PRE MASTER — mixer sync OFF          │
│             │  [✓] BASS — mixer sync ON                  │
│             │  [✓] VOCALS — mixer sync ON                │
│             │  ... (expandable list of all 35 tracks)   │
├─────────────┼───────────────────────────────────────────┤
│ RECENT      │  12:34 — Partner: volume DRUMS 0.47→0.65  │
│ CHANGES     │  12:33 — Partner: mute HH ON              │
│             │  12:30 — You: add clip BASS scene 2        │
│             │  12:28 — Partner saved: +1 track, +3 notes│
├─────────────┼───────────────────────────────────────────┤
│ GIT         │  Last: [coLaB] Add track 'Vocals'         │
│ HISTORY     │  Prev: [coLaB] Edit 3 clips, BPM 130→140 │
│             │  [View full diff] [Revert to this version]│
└─────────────┴───────────────────────────────────────────┘
```

---

## Implementation Plan (ordered by dependency)

### Phase 1: AbletonBridge Client (ableton-client.js)
**Priority: CRITICAL — everything depends on this**

Build a Node.js TCP client that connects to AbletonBridge's Remote Script on localhost:9877. Must support:

1. `send(type, params)` → returns Promise with result
2. `observe(property, callback)` → push-based change notifications
3. `batch(commands)` → send multiple commands in one round-trip
4. Connection management with auto-reconnect
5. Command queuing during disconnection

```javascript
var client = new AbletonClient({ host: '127.0.0.1', port: 9877 });
await client.connect();

// Query
var session = await client.send('get_session_info');
var tracks = await client.send('get_all_tracks_info');

// Modify
await client.send('set_tempo', { tempo: 140 });
await client.send('set_track_volume', { track_index: 2, volume: 0.72 });

// Observe (push-based)
client.observe('selected_track', function(data) {
  console.log('Cursor moved to track:', data.index, data.name);
});
```

**Files:** `js/hub/ableton-client.js` (~400 lines)
**Depends on:** AbletonBridge Remote Script running (verified ✓)
**Test:** Query session info, set tempo, observe selected_track changes

### Phase 2: Cursor Sync (cursor-sync.js)
**Priority: HIGH — the most visible feature**

Dedicated module that:
1. Observes local cursor position via ableton-client
2. Sends updates to peer via engine UDP (throttled to 15Hz)
3. Receives partner cursor from engine
4. Optionally scrolls view to follow partner
5. Provides cursor data to web-bridge for browser visualization

```javascript
var cursorSync = new CursorSync(abletonClient, engine);
cursorSync.start();

cursorSync.on('partner_cursor', function(data) {
  // data: { track: 5, scene: 2, user: "partner", trackName: "BASS" }
});

cursorSync.setFollowPartner(true);  // auto-scroll to partner's position
cursorSync.setFollowPartner(false); // just show highlight, don't move
```

**Files:** `js/hub/cursor-sync.js` (~200 lines)
**Depends on:** Phase 1 (ableton-client.js), colab-engine.js (exists ✓)

### Phase 3: Parameter Sync (param-sync.js)
**Priority: HIGH — makes collaboration actually work**

1. Snapshots all track parameters on connect
2. Observes changes via ableton-client
3. Diffs against snapshot, sends deltas to peer
4. Receives partner deltas, applies via ableton-client
5. Conflict detection: if both touch same param within 500ms, last-write-wins with notification
6. Per-track sync toggle support

```javascript
var paramSync = new ParamSync(abletonClient, engine, syncConfig);
paramSync.start();

// Disable mixer sync for a specific track
paramSync.setTrackSync(0, { mixer: false });

// Pause all sync temporarily
paramSync.pause();
paramSync.resume();
```

**Files:** `js/hub/param-sync.js` (~300 lines)
**Depends on:** Phase 1, colab-engine.js

### Phase 4: Audio Toggle (audio-toggle.js)
**Priority: MEDIUM — nice to have**

1. Manages a "Partner Monitor" concept
2. In PCM mode: controls pcm-stream receiver mute/volume
3. In Param Mirror mode: controls whether partner's mixer changes apply locally
4. Per-track granularity

```javascript
var audioToggle = new AudioToggle(abletonClient, engine, paramSync);

audioToggle.setGlobalMute(false);     // hear partner
audioToggle.setGlobalMute(true);      // solo mode
audioToggle.setTrackMute(2, true);    // mute partner's changes on track 2
audioToggle.getState();               // { global: false, tracks: { 2: true } }
```

**Files:** `js/hub/audio-toggle.js` (~200 lines)
**Depends on:** Phase 3 (param-sync.js), pcm-stream.js (exists ✓)

### Phase 5: Sync Controller (sync-controller.js)
**Priority: HIGH — ties everything together**

Master orchestrator that:
1. Manages sync configuration (what syncs, per-track overrides)
2. Coordinates cursor-sync, param-sync, audio-toggle
3. Handles connect/disconnect lifecycle
4. Saves/restores sync preferences per session
5. Exposes API for browser UI

```javascript
var sync = new SyncController(abletonClient, engine, {
  cursorSync: true,
  transportSync: true,
  structureSync: true,
  mixerSync: true,
  audioMonitor: false,
  trackOverrides: { 0: { mixerSync: false } }
});

sync.start();
sync.on('partner_change', function(change) { /* for UI */ });
sync.on('conflict', function(conflict) { /* both touched same param */ });
sync.getFullState(); // for dashboard
```

**Files:** `js/hub/sync-controller.js` (~500 lines)
**Depends on:** Phases 1-4

### Phase 6: Web-Bridge Integration + Browser UI
**Priority: MEDIUM — monitoring and control**

1. Add sync-controller endpoints to web-bridge
2. Build browser dashboard with all panels from the spec above
3. WebSocket real-time updates for cursor, params, diffs, git history

**New endpoints:**
```
GET  /api/sync/state          — full sync state + config
POST /api/sync/config         — update sync toggles
POST /api/sync/track/:id      — per-track override
GET  /api/sync/partner        — partner cursor + online status
GET  /api/sync/changes        — recent change feed
POST /api/sync/audio-toggle   — toggle partner audio
```

**Files:** `web-bridge/server.js` (extend), `web-bridge/ui/dashboard.html` (~800 lines)
**Depends on:** Phase 5

### Phase 7: Integration Testing
**Priority: CRITICAL — must work end-to-end**

1. Start engine on both machines
2. Connect peers
3. Select tracks on Machine A → verify cursor appears on Machine B
4. Change volume on Machine A → verify fader moves on Machine B
5. Toggle audio off on Machine B → verify Machine A's changes stop applying
6. Save on Machine A → verify diff notification on Machine B
7. Stress test: rapid parameter changes from both sides simultaneously

---

## File Tree (after implementation)

```
colab/
├── js/
│   ├── hub/
│   │   ├── ableton-client.js      ← NEW: TCP client for AbletonBridge :9877
│   │   ├── sync-controller.js     ← NEW: master sync orchestrator
│   │   ├── cursor-sync.js         ← NEW: cursor tracking + partner highlight
│   │   ├── param-sync.js          ← NEW: parameter delta sync
│   │   ├── audio-toggle.js        ← NEW: partner audio control
│   │   ├── colab-engine.js        ← MODIFY: wire new modules, remove M4L dep
│   │   ├── tcp-stack.js           ← EXISTS: peer transport (TCP)
│   │   ├── lan-transport.js       ← EXISTS: peer transport (UDP)
│   │   ├── pcm-stream.js          ← EXISTS: audio streaming
│   │   ├── als-differ.js          ← EXISTS: semantic .als diff
│   │   ├── als-git.js             ← EXISTS: git auto-commit
│   │   ├── asset-resolver.js      ← EXISTS: sample tracking
│   │   └── ...
│   └── shared/
│       ├── constants.js            ← MODIFY: add AbletonBridge port
│       └── protocol.js             ← EXISTS
├── web-bridge/
│   ├── server.js                   ← MODIFY: add sync endpoints
│   └── ui/
│       └── dashboard.html          ← NEW: sync dashboard
├── AbletonBridge/                  ← EXTERNAL: cloned from hidingwill
│   ├── AbletonBridge_Remote_Script/  ← Installed as Control Surface ✓
│   ├── MCP_Server/                   ← Registered as MCP server ✓
│   └── M4L_Device/                   ← Available for deep LOM access
├── docs/
│   ├── sync-methods.md             ← EXISTS: 5 method comparison
│   ├── unified-program-design.md   ← EXISTS: architecture doc
│   ├── workstreams.md              ← EXISTS: 8 independent modules
│   └── PLAN-LiveSync-ALSdiff.md    ← THIS FILE
└── test/
    ├── stress-tcp.js               ← EXISTS
    ├── stress-tcp-real-nic.js      ← EXISTS
    ├── packet-trace.js             ← EXISTS
    ├── send-to-haven.js            ← EXISTS
    └── test-livesync.js            ← NEW: end-to-end sync test
```

---

## Startup Sequence (both machines)

```bash
# 1. Ableton must be running with AbletonBridge Control Surface active
#    (Settings → Link, Tempo, MIDI → AbletonBridge)

# 2. Start the coLaB engine
cd ~/colab/web-bridge
COLAB_PROJECT="/path/to/shared/project" \
COLAB_ALS="session.als" \
COLAB_PEER="192.168.0.83" \
ABLETON_BRIDGE_PORT=9877 \
node server.js

# 3. Open browser dashboard
# http://localhost:3030

# 4. Verify connection
curl http://localhost:3030/api/engine/stats
curl http://localhost:3030/api/sync/state
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| AbletonBridge observe_property not working for all params | HIGH | Fall back to polling at 10Hz for unobservable properties |
| Simultaneous saves corrupt .als on OneDrive | HIGH | OneDrive conflict detection in engine, alert user |
| Param sync echo loop (A→B→A→B...) | CRITICAL | Suppress flag: don't re-send changes that came from peer |
| High-frequency param changes flood network | MEDIUM | Throttle to 50Hz, batch updates, delta-only |
| Ableton crashes during sync | LOW | Auto-reconnect in ableton-client.js, graceful degradation |
| TheHAVEN can't run AbletonBridge (permissions) | MEDIUM | Already installed and working ✓ |

---

## Success Criteria

1. ✅ Both users see partner's cursor move in real-time (<100ms)
2. ✅ Parameter changes from one user appear on the other within <200ms
3. ✅ Partner audio toggle works — can hear/mute partner's changes independently
4. ✅ Per-track sync overrides work — can exclude specific tracks from sync
5. ✅ Save triggers semantic diff with human-readable commit message
6. ✅ Git history shows complete change timeline
7. ✅ No echo loops — changes propagate exactly once
8. ✅ Graceful degradation — if peer disconnects, local editing continues unaffected
9. ✅ Browser dashboard shows full sync state in real-time
10. ✅ Works with 35+ track projects at 130 BPM without audio dropouts

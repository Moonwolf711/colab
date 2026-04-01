# coLaB Sync Methods — 5 Approaches to Live Ableton Session Sync

## Overview

Two machines on the same LAN:
- **This PC** (192.168.0.3) — `C:\Users\Owner\colab\`
- **TheHAVEN** (192.168.0.83) — `C:\Users\4382\colab\`

Goal: Real-time cursor tracking, parameter sync, and session state between two Ableton Live instances.

---

## Method 1: Direct M4L UDP (Original)

**How it works:**
Both machines load a Max for Live device that uses LiveAPI to read/write Ableton state and UDP to communicate directly peer-to-peer.

**Architecture:**
```
Ableton (.3)                              Ableton (.83)
  CoLaB_v5.amxd                            CoLanew.amxd
  [js colab_hub_v5.js]                      [js colab_hub_v5.js]
  outlet 0 → [udpsend .83:8001]            outlet 0 → [udpsend .3:8001]
  [udpreceive 8001] → inlet                [udpreceive 8001] → inlet
  metro 500ms → poll()                     metro 100ms → poll()
```

**What syncs:** Cursor position, track mute/solo, transport state (play/stop/tempo)

**Files involved:**
- `colab_hub_v5.js` — LiveAPI polling, change detection, JSON diff/apply
- `CoLaB_v5.amxd` — M4L device for this PC (sends to .83)
- `CoLanew.amxd` — M4L device for TheHAVEN (sends to .3)

**Pros:**
- Lowest latency (direct UDP, no middleware)
- LiveAPI has full read/write access to Ableton
- Already built and tested (cursor sync confirmed working previously)

**Cons:**
- Requires manually loading the .amxd on a track in both sessions
- IPs hardcoded in the .amxd patcher
- No file/sample sync
- UDP is unreliable (can lose packets)

**Status:** Devices built, JS deployed to both machines. Fixed IP typo in CoLanew.amxd (was 192.163, now 192.168). Upgraded to v5 JS on TheHAVEN.

**To test:** Load CoLaB_v5.amxd on a track in Ableton on .3, load CoLanew.amxd on .83. Click "connect" message in either device.

---

## Method 2: OneDrive Shared Project + M4L Auto-Connect

**How it works:**
Both machines open the SAME .als project file from a shared OneDrive folder. The project already has the CoLanew device saved inside it, so the M4L device boots automatically when the project opens. The M4L device discovers the peer and starts syncing. OneDrive handles file-level sync (the .als itself, samples, presets).

**Architecture:**
```
OneDrive (shared folder)
  └── colab-session/
      ├── colab-session.als    ← both open this
      ├── Samples/Collected/   ← OneDrive syncs samples
      └── Presets/             ← OneDrive syncs presets

Machine A opens .als → CoLanew boots → discovers peer → real-time sync
Machine B opens .als → CoLanew boots → discovers peer → real-time sync

Real-time layer (M4L UDP):
  cursor, params, transport ←→ UDP 8001

File layer (OneDrive):
  .als, samples, presets ←→ OneDrive cloud sync

Version layer (als-git):
  semantic diffs → git commit → git push
```

**What syncs:**
- Real-time: cursor, parameters, transport (via M4L UDP)
- Files: .als project, samples, presets (via OneDrive)
- History: semantic git commits with human-readable messages (via als-git)

**Files involved:**
- `colab_hub_v5.js` — real-time sync engine
- `als-differ.js` — semantic .als diff
- `als-git.js` — auto-commit on save
- `asset-resolver.js` — sample/plugin dependency tracking
- Shared .amxd saved inside the .als project

**Pros:**
- Zero manual setup after first project creation
- Opening the .als auto-loads the M4L device
- OneDrive handles sample sync (no manual file transfer)
- Git history gives full version control
- Works even if one person is offline (OneDrive syncs later)

**Cons:**
- OneDrive sync latency (seconds to minutes for large .als files)
- Conflict risk if both save simultaneously (OneDrive creates duplicates)
- Requires both users on same OneDrive/Microsoft account
- .als file lock — Ableton holds the file open, OneDrive may conflict

**Status:** All JS modules built. Need to create the shared OneDrive project with device pre-loaded.

**To test:**
1. Create project folder in shared OneDrive location
2. Create .als with CoLanew device on a track
3. Run `Collect All and Save` to bundle samples
4. Open from both machines
5. Verify M4L device auto-connects

---

## Method 3: Node.js Web Bridge + TCP Stack

**How it works:**
A Node.js server runs alongside Ableton on each machine. The server communicates with Ableton via the M4L device's UDP bridge (port 8001 → 8003) and with the peer via the tcp-stack.js module. A browser-based UI shows the partner's cursor, parameter changes, and session activity.

**Architecture:**
```
Machine A                                Machine B
  Ableton ← LiveAPI → M4L device          Ableton ← LiveAPI → M4L device
       ↓ UDP 8001                               ↓ UDP 8001
  web-bridge/server.js                     web-bridge/server.js
       ↓ TCP 9229 (tcp-stack.js)                ↑
       └──────────── LAN ──────────────────────┘
       ↓ HTTP 3030                              ↓ HTTP 3030
  Browser UI (cursor overlay,              Browser UI
  activity feed, file status)
```

**What syncs:**
- Real-time: cursor, parameters, transport (via M4L → web-bridge → TCP)
- Files: samples, presets (via tcp-stack.js reliable delivery)
- Manifests: sample/plugin dependency comparison
- Audio: PCM stream channels (via pcm-stream.js)
- Activity: session log with partner change tracking

**Files involved:**
- `web-bridge/server.js` — HTTP + WebSocket + UDP bridge
- `tcp-stack.js` — TCP/IP transport (tested across LAN, 0 errors)
- `pcm-stream.js` — 48kHz/16-bit audio streaming
- `asset-resolver.js` — file manifest comparison
- `als-differ.js` — semantic project diffs
- `als-git.js` — auto-commit

**Pros:**
- Full-featured (audio, files, cursors, params, activity log, recap)
- Browser UI — no special software needed to monitor
- TCP guarantees delivery for file transfers
- Tested: 640KB sent to TheHAVEN, 100% delivery, 1ms RTT
- PCM audio streaming tested: 500 frames, 0 errors

**Cons:**
- Requires running `node web-bridge/server.js` on both machines
- Still needs M4L device loaded for LiveAPI access
- More moving parts (Node server + M4L device + browser)

**Status:** tcp-stack.js tested across real LAN. web-bridge/server.js operational. pcm-stream.js tested. Need to wire tcp-stack into web-bridge (currently uses raw UDP).

**To test:**
1. Load M4L device in Ableton on both machines
2. Run `node web-bridge/server.js` on both
3. Open browser to `http://localhost:3030` on both
4. Verify cursor/param sync in browser UI

---

## Method 4: AbletonOSC + Sync Bridge

**How it works:**
AbletonOSC (a MIDI Remote Script) runs inside Ableton and exposes the entire Live Object Model via OSC over UDP. A Node.js sync bridge polls both instances via OSC and forwards changes between them over the TCP stack. No M4L device needed — AbletonOSC is a Control Surface that loads automatically.

**Architecture:**
```
Machine A                                Machine B
  Ableton                                 Ableton
  AbletonOSC (MIDI Remote Script)         AbletonOSC (MIDI Remote Script)
  UDP 11000 (commands)                     UDP 11000 (commands)
  UDP 11001 (responses)                    UDP 11001 (responses)
       ↓                                       ↑
  sync-bridge.js                          sync-bridge.js
       ↓ TCP 9229                               ↑
       └──────────── LAN ──────────────────────┘
```

**What syncs:**
- Cursor: `live_set view selected_track` / `selected_scene`
- Parameters: track volume, pan, mute, solo, arm, sends
- Transport: play/stop, tempo, time signature
- Clips: fire, stop, create, delete
- Devices: on/off, parameter values

**Files involved:**
- AbletonOSC (installed in User Remote Scripts on both machines)
- `sync-bridge.js` — polls OSC, diffs state, forwards to peer (TO BUILD)
- `tcp-stack.js` — transport between bridges
- `ableton-cli/` — existing CLI for AbletonOSC interaction

**Pros:**
- No M4L device needed (AbletonOSC is a Control Surface)
- Full LOM access via OSC (more complete than the v5 hub's polling)
- AbletonOSC auto-loads on Ableton startup (once configured)
- Can run entirely from Node.js — no Max dependency

**Cons:**
- Requires one-time manual activation in Ableton Settings (per machine)
- OSC polling adds latency vs LiveAPI callbacks
- AbletonOSC is a third-party dependency
- No audio streaming (would need separate PCM path)

**Status:** AbletonOSC installed on both machines (User Remote Scripts). Not yet activated in Ableton Settings (requires UI click). sync-bridge.js not yet built.

**To test:**
1. Activate AbletonOSC in Ableton Settings on both machines
2. Build and run sync-bridge.js on both
3. Select tracks, change parameters, verify sync

---

## Method 5: Git-Based Async Sync (als-differ + als-git)

**How it works:**
Both machines clone the same git repo containing the Ableton project. When either user saves in Ableton, als-git.js detects the file change, runs als-differ.js to generate a semantic diff, auto-commits with a descriptive message, and pushes to the shared remote. The other machine pulls changes, and the als-differ engine shows what changed. This is NOT real-time — it's save-by-save version control.

**Architecture:**
```
Machine A                                Machine B
  Ableton saves .als                       Ableton saves .als
       ↓                                       ↓
  als-git.js (fs.watch)                   als-git.js (fs.watch)
       ↓                                       ↓
  als-differ.js (semantic diff)           als-differ.js (semantic diff)
       ↓                                       ↓
  git commit "[coLaB] Add track           git commit "[coLaB] Edit 3 clips,
  'Bass', Notes +12/-3, BPM 120→128"     Notes +8, Adjust mix (2 params)"
       ↓                                       ↓
  git push ←── GitHub/shared repo ──→ git pull
       ↓                                       ↓
  Recap: "Partner added Bass track,       Recap: "Partner edited clips..."
  changed 12 notes..."
```

**What syncs:**
- Everything in the .als file (tracks, clips, notes, devices, transport, mixer)
- Samples via git LFS or Collect All and Save
- Full semantic change history

**Files involved:**
- `als-differ.js` — SAX-based semantic diff (strips 60+ junk fields)
- `als-git.js` — watches saves, auto-commits, auto-pushes
- `asset-resolver.js` — sample manifest for Collect All and Save verification
- `recap-generator.js` — human-readable session summaries

**Pros:**
- Complete project sync (not just params — everything)
- Full version history with semantic commit messages
- Works across ANY network (not just LAN — via GitHub)
- Offline-capable (commit locally, push when connected)
- IP protection: proprietary als-differ is first-of-its-kind
- No Ableton plugins or M4L devices needed

**Cons:**
- NOT real-time (sync happens on save, typically 30s-5min lag)
- No cursor tracking
- No live parameter watching
- Merge conflicts possible if both edit the same section
- Large .als files (50-200MB with samples) slow to push/pull

**Status:** All modules built and tested. als-differ verified on real .als XML structure. als-git auto-commit with semantic messages working.

**To test:**
1. Init git repo in shared Ableton project folder
2. Run `als-git.watch('path/to/project.als')`
3. Make changes in Ableton, save (Ctrl+S)
4. Verify auto-commit with semantic message
5. Pull on other machine, check diff

---

## Comparison Matrix

| Feature | M1: Direct UDP | M2: OneDrive+M4L | M3: Web Bridge | M4: AbletonOSC | M5: Git Async |
|---------|---------------|-------------------|----------------|----------------|---------------|
| Real-time cursor | Yes | Yes | Yes | Yes | No |
| Real-time params | Yes | Yes | Yes | Yes | No |
| File/sample sync | No | Yes (OneDrive) | Yes (TCP) | No | Yes (git) |
| Audio streaming | No | No | Yes (PCM) | No | No |
| Version history | No | Yes (als-git) | Yes (als-git) | No | Yes (als-git) |
| Needs M4L device | Yes | Yes (auto-loaded) | Yes | No | No |
| Needs Node.js | No | Optional | Yes | Yes | Yes |
| Setup complexity | Low | Medium | High | Medium | Low |
| Works over internet | No | Yes | No (LAN only) | No (LAN only) | Yes |
| Latency | ~50ms | ~50ms | ~10ms | ~100ms | Minutes |

---

## Recommended Test Order

1. **Method 5 (Git Async)** — Easiest to test, no UI interaction needed on remote
2. **Method 1 (Direct UDP)** — Already built, just needs devices loaded
3. **Method 2 (OneDrive+M4L)** — Best long-term solution, needs shared project setup
4. **Method 3 (Web Bridge)** — Most features, needs Node running on both
5. **Method 4 (AbletonOSC)** — Cleanest architecture, needs Settings UI click

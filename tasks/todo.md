# CoLaB Consolidation — Target (b): Single Self-Contained M4L Device

## Reusable Max for Live agent skill — 2026-10-20

Deliver an installed `max-for-live-amxd` skill plus a versioned copy under
`skills/`. Include source-verified AMXD packaging, native device UI and lifecycle
guidance, MCP discovery/setup references, and the MouseMux SDK bridge lessons.
Skill installation is the deployment; no database migration or Railway service
applies. Preserve the separate device implementation work already in progress.

- [x] Inspect local project instructions, builders, MCP servers, and official Max documentation.
- [x] Write the skill, MCP metadata/references, and a template-based AMXD helper.
- [x] Validate the skill and helper; independently exercise realistic task routing.
- [x] Install under the active Codex skills directory and verify copied files.
- [x] Commit the skill's scoped changes, push origin/master, and verify remote delivery.

Verification: skill validator, MCP metadata, and reference links pass; all 13
helper tests and 43 existing repository tests pass. All three installed stock
AMXD categories pass inspection. An independent agent used the skill to build
and inspect a fresh MIDI pass-through package in a temporary directory.
This proves offline authoring, not Live loading or physical MIDI behavior.

Delivery: eight files installed and hash-verified at
`C:\Users\Owner\.codex\skills\max-for-live-amxd`. Skill implementation commit
`f8654fe` is on origin/master; Node 18/20/22 CI run `39385704832` passed.
MaxMSP and Producer Pal integration metadata and setup guidance are included;
active MCP connections remain unverified. No runtime/configuration changes or
database migrations were required for this skill installation.

## MouseMux integration — 2026-10-19

Scope: add independent MouseMux user input to CoLaB's existing multi-cursor path, including the pointer features consumed by its Jam interface. Preserve the consolidation work below and unrelated workspace changes. Keyboard forwarding, screen sharing, and native desktop virtualization remain MouseMux capabilities rather than implemented CoLaB Jam features.

- [x] Run the installed REA tooling against the nine supplied 3.0.19 x86 DLLs; record hashes, public interfaces, and evidence-backed limitations.
- [x] Verify the V3 input contract and select the smallest compatible integration with CoLaB's existing mouse pipeline.
- [x] Implement original integration code and usage documentation; keep vendor binaries and raw decompilation outside the repository.
- [x] Verify input identity, motion/buttons/wheels, disconnect cleanup, and existing consumer behavior with appropriate builds/tests and a local smoke check.
- [x] Commit only this task's files, push to origin/master, and verify the applicable deployment or local installation status.

Success: a reproducible MouseMux-to-CoLaB input path, tested without disturbing an active Ableton session, with exact instructions and explicit live-test limitations.

Verification: 43 tests pass on the current Node runtime and Node 18; a clean detached checkout passes `npm ci --ignore-scripts` and all 43 tests. Panel inline JavaScript parses. A local 100,000-event motion benchmark averaged 1.86 microseconds/event for decoded input through the adapter and Jam core (network, rendering, and Ableton excluded). Physical-input validation remains pending: MouseMux's Web SDK is disabled/not listening on 41001, and panel calibration requires the actual canvas screen rectangle. No schema changes or Railway runtime apply to this Windows desktop feature.

Delivery: implementation commits pushed to origin/master; GitHub Actions run 39312135001 passed on Node 18/20/22. Local demo at `http://127.0.0.1:9460` returns a 24-track simulated set, MouseMux disconnected/ECONNREFUSED, and input disabled. Its sample rectangle must be calibrated before live use. Brave UI verification could not run because CDP was unavailable; IP Helper was stopped according to the workspace browser instructions and Brave requires relaunch from its debug shortcut.

REA final coverage: all nine overviews succeeded with zero main-batch tool errors; 31/31 selected exported-function requests succeeded, in 627.87 seconds. Raw results remain outside the repository; see `docs/mousemux-analysis.md` for hashes, counts, exact evidence boundaries, and the separate focus pass's two unsuccessful exploratory internal-address lookups.

**Goal:** One `.amxd` a collaborator drops on a track → opens the `.als` → plays. **Zero install** (no Node.js, no AbletonBridge Remote Script, no AbletonOSC, no web-bridge). North star: *easy for a friend to join and play* > technical completeness.

## Decision (from architecture map, 2026-06-24)
- **Base = `colab-sync-v8.js` (v8.1)** — already self-contained (LiveAPI + UDP `[js]`), **dynamic** (discovers tracks/devices on ANY Set), and solves the LiveAPI null-callback stall via `.id == 0` guards + avoiding `arm`/`fold_state`/`is_foldable` (uncatchable spam on group/return tracks).
- **Reference for richer coverage = `colab_livesync.js` (v7)** — has master params, clips (create/delete), notes — but **hardcoded** to Tyler's Set (`DEVICE_MAP`, `GROUP_TRACKS`). Port its *logic* dynamically; do NOT inherit its hardcoding.
- **Transport:** UDP `[udpsend]/[udpreceive 8001]` only (legacy `[js]` has no TCP). Patcher topology = `CoLanew.maxpat` (swap JS filename).
- **Hard constraint:** structural ops (clip create/delete, notes) are **non-idempotent** → UDP loss = permanent divergence. Param deltas self-heal (re-polled). Reliability layer needed only for structural ops.

## Staged build (verify each before the next — do NOT build on an untested base)

### Step A — Build + locally smoke-test the v8.1 base device  ← START HERE
- [ ] Build a clean `.amxd` (ampf binary) wrapping `colab-sync-v8.js` using the `CoLanew.maxpat` topology (metro 100 → poll, udpsend/udpreceive 8001, live.thisdevice → init).
- [ ] Load on a track in **this** machine's Live 12 Beta. Verify: inits after 3s, discovers tracks+devices, polls with **zero Max-console spam**, no scheduler stall.
- [ ] Loopback self-test: confirm it emits deltas on a fader move (watch udpsend) without echo storm.

### Step B — Two-machine flawless core (needs TheHAVEN online)
- [ ] Deploy device + JS to TheHAVEN (`4382@192.168.0.83`), same `.als` both ends.
- [ ] Verify both directions, flawless, no echo loop, no spam: **volume, pan, mute, solo, color, name, device params, tempo.**
- [ ] Measure: latency to peer-follow, drift over 5 min, behavior on a track/device the peer lacks.

### Step C — Consolidate up to v9 (dynamic port of v7 features)
- [ ] Add **master device params** (dynamic discovery).
- [ ] Add **clips**: create / delete / note-sync (dynamic clip-slot scan) — from v7 logic, dynamic.
- [ ] **Reliability layer for structural ops only:** sequence number + peer ACK + retransmit-on-timeout, plus a periodic clip-state reconcile (occupancy + note-hash) to self-heal any dropped structural delta. Keep it minimal — no full CRDT.
- [ ] Re-run Step B verification + structural-op stress (rapid clip create/delete/edit).

### Deferred (not "core jam"; add only if asked)
- arm / fold sync (need a spam-free foldable-track detection — `is_foldable` is banned)
- routing / returns / crossfader / scenes / warp markers / clip props (A's extra ~1,387 coverage)
- PCM audio streaming, .als file/asset/git sync, cursor overlay, control-panel UI polish

## Cleanup / hygiene
- [x] Removed 40 zero-byte shell-accident junk files.
- [ ] Commit a deliberate known-good base (CoLaB consolidation files), grouped by concern; leave unrelated WIP (Skallywag, FightingEdge) alone.

## Test gate for "flawless"
Two machines, same Set, a real jam session: faders/knobs/tempo/clips track both ways with no audible lag, no echo oscillation, no console spam, no divergence after 10 min. A friend with stock Ableton + the single device joins with zero other installs.
